
import io
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from PIL import Image, UnidentifiedImageError

# =========================================================
# PATHS AND CONFIGURATION
# =========================================================

BASE_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = BASE_DIR / "frontend"

load_dotenv(BASE_DIR / ".env")

DATABASE_URL = os.getenv("DATABASE_URL")

MODEL_FILE = Path(
    os.getenv(
        "DETECTOR_MODEL_PATH",
        str(BASE_DIR / "models" / "best.pt"),
    )
).expanduser()

try:
    YOLO_CONFIDENCE = float(os.getenv("YOLO_CONFIDENCE", "0.25"))
except (TypeError, ValueError):
    YOLO_CONFIDENCE = 0.25

YOLO_CONFIDENCE = max(0.01, min(1.0, YOLO_CONFIDENCE))

MAX_IMAGE_BYTES = 8 * 1024 * 1024
ALERT_LOG_COOLDOWN_SECONDS = 30

# Only these classes can trigger camera alerts.
# "monitor" and "doorbell" are deliberately not alert classes:
# seeing a monitor does not establish that it contains a camera.
CAMERA_CLASSES = {
    "camera",
    "spy_camera",
    "hidden_camera",
    "security_camera",
    "surveillance_camera",
    "pinhole_camera",
    "camera_lens",
    "webcam",
    "mini_camera",
    "miniature_camera",
    "ip_camera",
    "cctv",
    "360_cam",
    "speed_camera",
    "digital_camera",
    "degital_camera",
    "dome",
    "bullet",
    "ptz",
    "turret",
}

HIDDEN_CAMERA_CLASSES = {
    "hidden_camera",
    "spy_camera",
}

detector_lock = threading.Lock()
alert_log_lock = threading.Lock()
last_logged_alert = {}

# =========================================================
# YOLO MODEL INITIALIZATION
# =========================================================

YOLO = None
YOLO_IMPORT_ERROR = None

try:
    from ultralytics import YOLO as YOLO_CLASS

    YOLO = YOLO_CLASS

except Exception as exc:
    YOLO_IMPORT_ERROR = str(exc)
    print(f"YOLO import failed: {exc}")

detector = None
detector_status = "model_missing"
detector_error = None
detector_classes = []
database_status = "disconnected"


def normalize_class_name(name):
    """Normalize class names for consistent matching."""
    return (
        str(name)
        .strip()
        .lower()
        .replace("-", "_")
        .replace(" ", "_")
    )


def is_camera_like(class_name):
    return normalize_class_name(class_name) in CAMERA_CLASSES


def is_hidden_camera_candidate(class_name):
    return normalize_class_name(class_name) in HIDDEN_CAMERA_CLASSES


def get_model_class_names(names):
    """Support the class-name dictionary and list formats used by YOLO."""
    if isinstance(names, dict):
        ordered_names = [
            name for _, name in sorted(
                names.items(),
                key=lambda pair: int(pair[0]),
            )
        ]
    elif isinstance(names, (list, tuple)):
        ordered_names = list(names)
    else:
        return []

    return [normalize_class_name(name) for name in ordered_names]


def get_matched_classes():
    available = set(detector_classes)

    return sorted(available & CAMERA_CLASSES)


def get_matched_hidden_classes():
    available = set(detector_classes)

    return sorted(available & HIDDEN_CAMERA_CLASSES)


def load_detector():
    global detector
    global detector_status
    global detector_error
    global detector_classes

    detector = None
    detector_classes = []
    detector_error = None

    if YOLO is None:
        detector_status = "dependency_missing"
        detector_error = YOLO_IMPORT_ERROR
        print(f"YOLO dependency unavailable: {YOLO_IMPORT_ERROR}")
        return

    if not MODEL_FILE.is_file():
        detector_status = "model_missing"
        detector_error = f"Model file not found: {MODEL_FILE}"
        print(detector_error)
        return

    try:
        candidate = YOLO(str(MODEL_FILE))
        names = candidate.names
        classes = get_model_class_names(names)

        if not classes:
            raise RuntimeError(
                "The YOLO model loaded but did not provide class names."
            )

        detector = candidate
        detector_classes = classes
        detector_status = "ready"

        matched = get_matched_classes()
        hidden_matched = get_matched_hidden_classes()

        print(f"YOLO model loaded: {MODEL_FILE}")
        print(f"Model classes: {detector_classes}")
        print(f"Recognized camera classes: {matched}")
        print(f"Recognized hidden-camera classes: {hidden_matched}")
        print(f"Confidence threshold: {YOLO_CONFIDENCE}")

        if not matched:
            print(
                "WARNING: No model class matches CAMERA_CLASSES. "
                "Ordinary detections can still be returned, but "
                "camera-specific alerts will not trigger."
            )

        if not hidden_matched:
            print(
                "WARNING: The model does not have a matching "
                "hidden_camera or spy_camera class."
            )

    except Exception as exc:
        detector = None
        detector_classes = []
        detector_status = "model_load_error"
        detector_error = str(exc)

        print(f"YOLO model loading failed: {exc}")


# =========================================================
# POSTGRESQL CONNECTION
# =========================================================

def get_connection():
    if not DATABASE_URL:
        raise HTTPException(
            status_code=503,
            detail=(
                "DATABASE_URL is missing. Check the project root "
                ".env file and make sure it is available to the backend."
            ),
        )

    try:
        return psycopg.connect(
            DATABASE_URL,
            row_factory=dict_row,
            connect_timeout=5,
        )

    except Exception as exc:
        print(f"PostgreSQL connection failed: {exc}")

        raise HTTPException(
            status_code=503,
            detail=(
                "Cannot connect to PostgreSQL. Check DATABASE_URL, "
                "credentials, hostname, and port."
            ),
        ) from exc


def initialize_database():
    global database_status

    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS alerts (
                id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                status VARCHAR(40) NOT NULL,
                score INTEGER NOT NULL DEFAULT 0
                    CHECK (score BETWEEN 0 AND 100),
                details TEXT NOT NULL DEFAULT '',
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )

        connection.commit()

    database_status = "connected"

    print("PostgreSQL connected.")
    print("Table 'alerts' created or already exists.")


def check_database():
    global database_status

    try:
        with get_connection() as connection:
            connection.execute("SELECT 1")

        database_status = "connected"
        return True

    except Exception as exc:
        database_status = "disconnected"
        print(f"Database health check failed: {exc}")
        return False


# =========================================================
# AUTOMATIC DETECTION LOGGING
# =========================================================

def save_detection_log(class_name, confidence, hidden=False):
    """
    Save recognized camera detections to PostgreSQL.

    The same class is logged at most once every 30 seconds.
    Ordinary objects do not create camera alerts.
    """
    global database_status

    normalized_name = normalize_class_name(class_name)

    if normalized_name not in CAMERA_CLASSES:
        return False

    now = datetime.now(timezone.utc)

    with alert_log_lock:
        previous = last_logged_alert.get(normalized_name)

        if previous is not None:
            elapsed = (now - previous).total_seconds()

            if elapsed < ALERT_LOG_COOLDOWN_SECONDS:
                return False

        score = max(0, min(100, round(confidence * 100)))

        status = (
            "Possible hidden camera"
            if hidden
            else "Camera detected"
        )

        details = (
            f"Model class: {normalized_name}; "
            f"confidence: {confidence:.1%}; "
            "Visual prediction only; manual inspection required."
        )

        try:
            with get_connection() as connection:
                connection.execute(
                    """
                    INSERT INTO alerts (status, score, details)
                    VALUES (%s, %s, %s)
                    """,
                    (status, score, details),
                )

                connection.commit()

            database_status = "connected"
            last_logged_alert[normalized_name] = now

            print(
                f"Detection saved to PostgreSQL: "
                f"{normalized_name} ({score}%)"
            )

            return True

        except Exception as exc:
            database_status = "disconnected"
            print(f"Could not save detection log: {exc}")
            return False


# =========================================================
# APPLICATION STARTUP
# =========================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    load_detector()

    try:
        initialize_database()

    except Exception as exc:
        global database_status
        database_status = "disconnected"
        print(f"Database initialization failed: {exc}")

    yield


app = FastAPI(
    title="Sentinel Spy Camera Scanner",
    version="5.3.0",
    lifespan=lifespan,
)


# =========================================================
# FRONTEND ROUTES
# =========================================================

@app.get("/")
def home():
    path = FRONTEND_DIR / "index.html"

    if not path.is_file():
        raise HTTPException(404, "frontend/index.html not found")

    return FileResponse(path)


@app.get("/styles.css")
def styles():
    path = FRONTEND_DIR / "styles.css"

    if not path.is_file():
        raise HTTPException(404, "frontend/styles.css not found")

    return FileResponse(path, media_type="text/css")


@app.get("/app.js")
def frontend_js():
    path = FRONTEND_DIR / "app.js"

    if not path.is_file():
        raise HTTPException(404, "frontend/app.js not found")

    return FileResponse(
        path,
        media_type="application/javascript",
    )


@app.get("/camera_inspection.js")
def inspection_js():
    path = FRONTEND_DIR / "camera_inspection.js"

    if not path.is_file():
        raise HTTPException(
            404,
            "frontend/camera_inspection.js not found",
        )

    return FileResponse(
        path,
        media_type="application/javascript",
    )


# =========================================================
# HEALTH CHECK
# =========================================================

@app.get("/api/health")
def health():
    db_ok = check_database()
    matched = get_matched_classes()
    hidden_matched = get_matched_hidden_classes()

    return {
        "app": "Sentinel Spy Camera Scanner",
        "version": "5.3.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),

        "database_status": database_status,
        "database_connected": db_ok,
        "database_table": "alerts",

        "detector_status": detector_status,
        "detector_ready": detector is not None,
        "detector_error": detector_error,

        "model_file_exists": MODEL_FILE.is_file(),
        "model_path": str(MODEL_FILE),

        "model_classes": detector_classes,
        "matched_camera_classes": matched,
        "hidden_camera_classes_available": hidden_matched,

        "camera_classes_available": bool(matched),
        "confidence_threshold": YOLO_CONFIDENCE,
    }


# =========================================================
# YOLO IMAGE DETECTION
# =========================================================

def run_detection(image_bytes):
    if detector is None:
        raise HTTPException(
            status_code=503,
            detail=(
                f"Detector is not ready: {detector_status}. "
                "Check /api/health and the backend logs."
            ),
        )

    if not image_bytes:
        raise HTTPException(400, "The image is empty.")

    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            413,
            "Maximum image size is 8 MB.",
        )

    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            image = source.convert("RGB")
            image.load()

    except (UnidentifiedImageError, OSError) as exc:
        raise HTTPException(
            400,
            "Invalid image. Upload JPEG, PNG, or WebP.",
        ) from exc

    image_width, image_height = image.size
    started_at = time.perf_counter()

    try:
        # YOLO model inference is protected against concurrent access.
        with detector_lock:
            predictions = detector.predict(
                source=image,
                imgsz=640,
                conf=YOLO_CONFIDENCE,
                verbose=False,
            )

        detections = []

        for result in predictions:
            boxes = result.boxes

            if boxes is None:
                continue

            names = result.names

            for box in boxes:
                class_id = int(box.cls[0].item())
                confidence = float(box.conf[0].item())

                if isinstance(names, dict):
                    class_name = names.get(
                        class_id,
                        str(class_id),
                    )
                elif (
                    isinstance(names, (list, tuple))
                    and 0 <= class_id < len(names)
                ):
                    class_name = names[class_id]
                else:
                    class_name = str(class_id)

                normalized_name = normalize_class_name(class_name)

                # Original-image pixel coordinates: [x1, y1, x2, y2].
                coordinates = [
                    round(float(value), 2)
                    for value in box.xyxy[0].tolist()
                ]

                camera_match = is_camera_like(normalized_name)
                hidden_match = is_hidden_camera_candidate(
                    normalized_name
                )

                item = {
                    # Standard fields used by the live frontend.
                    "class": normalized_name,
                    "class_name": normalized_name,
                    "label": normalized_name,
                    "confidence": round(confidence, 4),

                    # Bounding boxes use x1, y1, x2, y2 pixel coordinates.
                    "bbox": coordinates,
                    "box": coordinates,

                    # Camera classification flags.
                    "camera_like": camera_match,
                    "cameraLike": camera_match,
                    "cameraDetection": camera_match,
                    "hidden_camera_candidate": hidden_match,
                    "hiddenCameraCandidate": hidden_match,
                }

                # Include all detections, not just camera classes.
                # The frontend can draw boxes for every returned object.
                detections.append(item)

                if camera_match:
                    save_detection_log(
                        class_name=normalized_name,
                        confidence=confidence,
                        hidden=hidden_match,
                    )

        camera_detections = [
            item
            for item in detections
            if item["camera_like"]
        ]

        hidden_camera_detections = [
            item
            for item in detections
            if item["hidden_camera_candidate"]
        ]

        inference_ms = round(
            (time.perf_counter() - started_at) * 1000,
            2,
        )

        if hidden_camera_detections:
            message = (
                "A possible hidden-camera class was detected. "
                "Inspect the object manually; this is not proof "
                "of surveillance."
            )

        elif camera_detections:
            message = (
                "A camera-related object was detected. "
                "Manual inspection is required."
            )

        elif detections:
            message = (
                f"YOLO returned {len(detections)} object detection(s), "
                "but none matched the configured camera classes."
            )

        else:
            message = (
                "YOLO completed inference but returned no objects "
                "above the configured confidence threshold."
            )

        # Keep a stable, frontend-friendly JSON response.
        return {
            "status": "completed",
            "detector": "local YOLO",
            "detector_status": detector_status,

            "confidence_threshold": YOLO_CONFIDENCE,
            "inference_ms": inference_ms,

            "image_width": image_width,
            "image_height": image_height,

            "detection_count": len(detections),
            "camera_detection_count": len(camera_detections),
            "hidden_camera_detection_count": len(
                hidden_camera_detections
            ),

            "camera_classes_available": bool(
                get_matched_classes()
            ),
            "hidden_camera_classes_available": bool(
                get_matched_hidden_classes()
            ),

            "camera_detected": bool(camera_detections),
            "hidden_camera_detected": bool(
                hidden_camera_detections
            ),

            # Primary array and compatibility aliases.
            "detections": detections,
            "predictions": detections,
            "results": detections,

            "camera_detections": camera_detections,
            "hidden_camera_detections": hidden_camera_detections,

            "message": message,
            "disclaimer": (
                "Visual detections are clues, not proof of a hidden "
                "camera. False positives and missed devices are possible."
            ),
        }

    except HTTPException:
        raise

    except Exception as exc:
        print(
            f"Detection error: {type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=500,
            detail=f"Detection failed: {type(exc).__name__}. "
                   "Check the backend logs.",
        ) from exc


# =========================================================
# IMAGE UPLOAD VALIDATION
# =========================================================

async def read_image_upload(file: UploadFile):
    allowed_types = {
        "image/jpeg",
        "image/png",
        "image/webp",
    }

    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=415,
            detail="Upload a JPEG, PNG, or WebP image.",
        )

    data = await file.read(MAX_IMAGE_BYTES + 1)

    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Maximum image size is 8 MB.",
        )

    if not data:
        raise HTTPException(
            status_code=400,
            detail="The uploaded image is empty.",
        )

    return data


# =========================================================
# DETECTION ENDPOINTS
# =========================================================

@app.post("/api/detect")
async def detect_image(file: UploadFile = File(...)):
    try:
        image_bytes = await read_image_upload(file)
        return run_detection(image_bytes)

    finally:
        await file.close()


@app.post("/api/detect/frame")
async def detect_camera_frame(file: UploadFile = File(...)):
    """
    Endpoint used by the live browser scanner.

    Expected request:
        multipart/form-data
        field name: file
        file type: JPEG, PNG, or WebP
    """
    try:
        image_bytes = await read_image_upload(file)
        return run_detection(image_bytes)

    finally:
        await file.close()


# =========================================================
# POSTGRESQL ALERT HISTORY API
# Existing table and route contracts are preserved.
# =========================================================

class AlertCreate(BaseModel):
    status: str = Field(min_length=1, max_length=40)
    score: int = Field(default=0, ge=0, le=100)
    details: str = Field(default="", max_length=5000)


@app.get("/api/alerts")
def list_alerts():
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, status, score, details, created_at
            FROM alerts
            ORDER BY created_at DESC, id DESC
            LIMIT 200
            """
        ).fetchall()

    return {
        "count": len(rows),
        "alerts": rows,
    }


@app.post("/api/alerts")
def create_alert(alert: AlertCreate):
    with get_connection() as connection:
        row = connection.execute(
            """
            INSERT INTO alerts (status, score, details)
            VALUES (%s, %s, %s)
            RETURNING id, status, score, details, created_at
            """,
            (
                alert.status,
                alert.score,
                alert.details,
            ),
        ).fetchone()

        connection.commit()

    return {
        "saved": True,
        "alert": row,
    }


@app.delete("/api/alerts")
def clear_alerts():
    with get_connection() as connection:
        connection.execute("DELETE FROM alerts")
        connection.commit()

    with alert_log_lock:
        last_logged_alert.clear()

    return {
        "cleared": True,
    }


# =========================================================
# DATABASE INSPECTION
# =========================================================

@app.get("/api/database/tables")
def database_tables():
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_type = 'BASE TABLE'
            ORDER BY table_name
            """
        ).fetchall()

    return {
        "database_status": "connected",
        "tables": [
            row["table_name"]
            for row in rows
        ],
    }


@app.get("/api/database/alerts")
def database_alerts():
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, status, score, details, created_at
            FROM alerts
            ORDER BY created_at DESC, id DESC
            """
        ).fetchall()

    return {
        "table": "alerts",
        "count": len(rows),
        "columns": [
            "id",
            "status",
            "score",
            "details",
            "created_at",
        ],
        "rows": rows,
    }
