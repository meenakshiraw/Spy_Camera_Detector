
"use strict";

/* =========================================================
   SENTINEL — LIVE SPY CAMERA SCANNER
   Frontend: HTML + CSS + JavaScript
   Backend: FastAPI + YOLO + PostgreSQL
   ========================================================= */

/* -------------------- HTML ELEMENTS -------------------- */

const $ = id => document.getElementById(id);

const video = $("video");
const videoWrap = $("videoWrap");
const overlay = $("detectionOverlay");

const startBtn = $("startBtn");
const stopBtn = $("stopBtn");
const switchCameraBtn = $("switchCameraBtn");

const zoomInBtn = $("zoomInBtn");
const zoomOutBtn = $("zoomOutBtn");
const zoomSlider = $("zoomSlider");
const zoomValue = $("zoomValue");
const zoomMessage = $("zoomMessage");

const alertBanner = $("alertBanner");
const alertSymbol = $("alertSymbol");
const alertTitle = $("alertTitle");
const alertText = $("alertText");
const alertLabel = $("alertLabel");

const analysisStatus = $("analysisStatus");
const analysisIcon = $("analysisIcon");
const analysisTitle = $("analysisTitle");
const analysisDescription = $("analysisDescription");

const scorePill = $("scorePill");
const analysisProgress = $("analysisProgress");
const detectionType = $("detectionType");
const resultText = $("resultText");
const detectionState = $("detectionState");

const cameraState = $("cameraState");
const cameraMode = $("cameraMode");
const cameraResolution = $("cameraResolution");
const modelStatus = $("modelStatus");
const scanMode = $("scanMode");
const scanStatus = $("scanStatus");
const streamStatus = $("streamStatus");
const continuousStatus = $("continuousStatus");
const lastScanTime = $("lastScanTime");

const historyBody = $("historyBody");
const historyMessage = $("historyMessage");
const refreshBtn = $("refreshBtn");
const clearBtn = $("clearBtn");

const headerStatus = $("headerStatus");
const headerDot = $("headerStatusDot");

/* -------------------- API SETTINGS -------------------- */

const HEALTH_API = "/api/health";
const DETECT_ENDPOINT = "/api/detect/frame";
const ALERTS_API = "/api/alerts";

const DEFAULT_CONFIDENCE_THRESHOLD = 0.25;
const SCAN_INTERVAL_MS = 1000;
const ALERT_COOLDOWN_MS = 5000;

const MAX_FRAME_WIDTH = 640;
const JPEG_QUALITY = 0.80;

const FRAME_HISTORY_LIMIT = 4;
const MIN_FRAMES_TO_CONFIRM = 2;

const CAMERA_CLASSES = new Set([
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
    "turret"
]);

const HIDDEN_CAMERA_CLASSES = new Set([
    "hidden_camera",
    "spy_camera",
    "pinhole_camera",
    "mini_camera",
    "miniature_camera",
    "camera_lens"
]);

const CLASS_THRESHOLDS = {
    camera: 0.25,
    spy_camera: 0.25,
    hidden_camera: 0.25,
    security_camera: 0.25,
    surveillance_camera: 0.25,
    pinhole_camera: 0.25,
    camera_lens: 0.25,
    webcam: 0.25,
    mini_camera: 0.25,
    miniature_camera: 0.25,
    ip_camera: 0.25,
    cctv: 0.25,
    "360_cam": 0.25,
    speed_camera: 0.25,
    digital_camera: 0.25,
    degital_camera: 0.25,
    dome: 0.25,
    bullet: 0.25,
    ptz: 0.25,
    turret: 0.25
};

/* -------------------- STATE -------------------- */

let mediaStream = null;
let videoTrack = null;

let running = false;
let scanning = false;
let detectorAvailable = false;
let cameraStarting = false;

let scanTimer = null;
let currentFacingMode = "environment";
let currentZoom = 1;
let nativeZoomSupported = false;

let lastAlertAt = 0;
let lastAlertKey = "";
let lastDetections = [];

let cameraStartGeneration = 0;
let historyRequestGeneration = 0;

let recentCameraFrames = [];
let lastFrameWidth = 0;
let lastFrameHeight = 0;

const overlayContext = overlay
    ? overlay.getContext("2d")
    : null;

const frameCanvas = document.createElement("canvas");
const frameContext = frameCanvas.getContext("2d");

/* -------------------- HELPERS -------------------- */

function setText(element, value) {
    if (element) element.textContent = value;
}

function setDisabled(element, value) {
    if (element) element.disabled = value;
}

function normalizeLabel(label) {
    return String(label || "")
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
}

function isCameraLabel(label) {
    return CAMERA_CLASSES.has(normalizeLabel(label));
}

function isHiddenCameraLabel(label) {
    return HIDDEN_CAMERA_CLASSES.has(normalizeLabel(label));
}

function confidenceThreshold(label) {
    return CLASS_THRESHOLDS[normalizeLabel(label)]
        ?? DEFAULT_CONFIDENCE_THRESHOLD;
}

function getConfidence(item) {
    let confidence = Number(
        item?.confidence ?? item?.score ?? item?.conf ?? 0
    );

    if (confidence > 1 && confidence <= 100) {
        confidence /= 100;
    }

    return Number.isFinite(confidence)
        ? Math.max(0, Math.min(1, confidence))
        : 0;
}

function getClassName(item) {
    return String(
        item?.class_name ??
        item?.class ??
        item?.label ??
        item?.name ??
        "object"
    );
}

function passesCameraThreshold(item) {
    const label = normalizeLabel(getClassName(item));

    return (
        isCameraLabel(label) &&
        getConfidence(item) >= confidenceThreshold(label)
    );
}

function formatError(error) {
    return error?.message || "An unexpected error occurred.";
}

async function apiRequest(url, options = {}) {
    const headers = { ...(options.headers || {}) };

    if (
        options.body &&
        !(options.body instanceof FormData) &&
        !headers["Content-Type"]
    ) {
        headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
        ...options,
        headers,
        cache: "no-store"
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            body.detail ||
            body.message ||
            `${response.status} ${response.statusText}`
        );
    }

    return body;
}

/* -------------------- STATUS UI -------------------- */

function setAlert(level, title, message, label) {
    if (alertBanner) {
        alertBanner.classList.remove(
            "neutral", "warning", "danger", "critical"
        );
        alertBanner.classList.add(level);
    }

    setText(alertTitle, title);
    setText(alertText, message);
    setText(alertLabel, label);

    setText(
        alertSymbol,
        ["danger", "critical"].includes(level)
            ? "!"
            : level === "warning"
                ? "⚠"
                : "✓"
    );
}

function setAnalysis(level, title, description) {
    if (analysisStatus) {
        analysisStatus.classList.remove(
            "neutral", "warning", "danger", "critical"
        );
        analysisStatus.classList.add(level);
    }

    setText(analysisTitle, title);
    setText(analysisDescription, description);

    setText(
        analysisIcon,
        ["danger", "critical"].includes(level)
            ? "!"
            : level === "warning"
                ? "⚠"
                : "◎"
    );
}

function setScanScore(score) {
    const value = Math.max(
        0,
        Math.min(100, Math.round(Number(score) || 0))
    );

    if (scorePill) {
        scorePill.replaceChildren();

        const suffix = document.createElement("small");
        suffix.textContent = "/100";

        scorePill.append(
            document.createTextNode(String(value)),
            suffix
        );
    }

    if (analysisProgress) {
        analysisProgress.style.width = `${value}%`;
    }
}

function setCameraState(online) {
    setText(
        cameraState,
        online ? "● ONLINE" : "● OFFLINE"
    );
}

function setScanningStatus(value) {
    setText(scanStatus, value);
}

/* -------------------- BACKEND HEALTH -------------------- */

async function checkHealth() {
    try {
        const health = await apiRequest(HEALTH_API);

        const status = String(
            health.detector_status ?? ""
        ).toLowerCase();

        detectorAvailable =
            status === "ready" ||
            status === "loaded" ||
            status === "true";

        const matched = health.matched_camera_classes || [];
        const dbConnected = health.database_connected === true;

        setText(
            modelStatus,
            detectorAvailable
                ? `YOLO ready · ${matched.length} matching classes`
                : `Model: ${health.detector_status || "unavailable"}`
        );

        setText(
            headerStatus,
            detectorAvailable
                ? "DETECTION AVAILABLE"
                : "SERVER CONNECTED"
        );

        headerDot?.classList.toggle(
            "offline",
            !detectorAvailable
        );

        if (historyMessage && dbConnected) {
            setText(historyMessage, "PostgreSQL connected.");
        }

        if (detectorAvailable) {
            setAlert(
                "neutral",
                "Scanner ready",
                matched.length
                    ? `Model loaded. Available camera classes: ${matched.join(", ")}.`
                    : "Model loaded. Start the camera to test live inference.",
                "READY"
            );
        } else {
            setAlert(
                "warning",
                "Check model status",
                health.detector_error ||
                    "The backend responded, but model readiness needs verification.",
                "MODEL STATUS"
            );
        }

        console.log("Sentinel health response:", health);
        return health;
    } catch (error) {
        detectorAvailable = false;

        setText(headerStatus, "SERVER OFFLINE");
        setText(modelStatus, "Backend unavailable");
        headerDot?.classList.add("offline");

        setAlert(
            "warning",
            "Backend connection failed",
            "Check that FastAPI is running and that this page is served from the backend.",
            "SERVER ERROR"
        );

        console.error("Health check failed:", error);
        return null;
    }
}

/* -------------------- CAMERA START -------------------- */

async function startCamera() {
    if (running || cameraStarting) return;

    if (!video) {
        setAlert(
            "danger",
            "Video element missing",
            'Your HTML must contain <video id="video">.',
            "HTML ERROR"
        );
        return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        setAlert(
            "warning",
            "Camera unavailable",
            "Open the site through localhost or HTTPS and allow camera access.",
            "UNAVAILABLE"
        );
        return;
    }

    cameraStarting = true;
    const generation = ++cameraStartGeneration;

    setDisabled(startBtn, true);
    setAlert(
        "neutral",
        "Starting camera",
        "Waiting for camera permission and video frames.",
        "STARTING"
    );

    try {
        stopCameraTracks();

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
                facingMode: { ideal: currentFacingMode },
                width: { ideal: 640 },
                height: { ideal: 360 },
                frameRate: { ideal: 24, max: 30 }
            }
        });

        if (generation !== cameraStartGeneration) {
            stream.getTracks().forEach(track => track.stop());
            return;
        }

        mediaStream = stream;
        videoTrack = stream.getVideoTracks()[0];

        video.srcObject = stream;
        video.muted = true;
        video.setAttribute("playsinline", "");

        await new Promise((resolve, reject) => {
            if (video.readyState >= 2 && video.videoWidth > 0) {
                resolve();
                return;
            }

            const timeout = setTimeout(() => {
                cleanup();
                reject(new Error("Camera did not provide a video frame."));
            }, 10000);

            function cleanup() {
                clearTimeout(timeout);
                video.removeEventListener("loadeddata", onReady);
                video.removeEventListener("error", onError);
            }

            function onReady() {
                cleanup();
                resolve();
            }

            function onError() {
                cleanup();
                reject(new Error("Unable to read camera video."));
            }

            video.addEventListener("loadeddata", onReady, { once: true });
            video.addEventListener("error", onError, { once: true });
        });

        await video.play();

        if (generation !== cameraStartGeneration) {
            stopCameraTracks();
            return;
        }

        running = true;
        lastDetections = [];
        recentCameraFrames = [];
        lastAlertAt = 0;
        lastAlertKey = "";

        videoWrap?.classList.add("camera-active");

        setDisabled(startBtn, true);
        setDisabled(stopBtn, false);
        setDisabled(switchCameraBtn, false);

        setCameraState(true);

        setText(
            cameraMode,
            currentFacingMode === "environment"
                ? "REAR CAMERA"
                : "FRONT CAMERA"
        );

        updateResolution();

        setText(streamStatus, "Connected");
        setText(continuousStatus, "Enabled");
        setText(scanMode, "Live YOLO detection");
        setScanningStatus("SCANNING");

        await configureZoom();

        resizeOverlay();
        clearOverlay();

        setAlert(
            "neutral",
            "Live scan started",
            "Camera frames are being sent to the YOLO backend.",
            "SCANNING"
        );

        setAnalysis(
            "neutral",
            "Analyzing live frames",
            "The model checks visible objects. Predictions alone cannot confirm whether a hidden camera is present."
        );

        setText(detectionType, "Waiting for detections");
        setText(resultText, "Analyzing camera frames...");
        setText(detectionState, "SCANNING");

        scanLoop();
    } catch (error) {
        stopCameraTracks();

        running = false;

        setDisabled(startBtn, false);
        setDisabled(stopBtn, true);
        setDisabled(switchCameraBtn, true);

        setCameraState(false);

        setAlert(
            "warning",
            "Could not start camera",
            error.name === "NotAllowedError"
                ? "Camera permission was denied. Allow access in your browser settings."
                : formatError(error),
            "CAMERA ERROR"
        );

        console.error("Camera start failed:", error);
    } finally {
        cameraStarting = false;

        if (!running) {
            setDisabled(startBtn, false);
        }
    }
}

function updateResolution() {
    if (video?.videoWidth && video?.videoHeight) {
        setText(
            cameraResolution,
            `${video.videoWidth} × ${video.videoHeight}`
        );
    }
}

function stopCameraTracks() {
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
    }

    mediaStream = null;
    videoTrack = null;

    if (video) {
        video.srcObject = null;
        video.style.transform = "";
    }
}

/* -------------------- STOP SCAN -------------------- */

function stopScan() {
    cameraStartGeneration++;

    running = false;
    scanning = false;

    if (scanTimer) {
        clearTimeout(scanTimer);
        scanTimer = null;
    }

    stopCameraTracks();

    recentCameraFrames = [];
    lastDetections = [];

    setDisabled(startBtn, false);
    setDisabled(stopBtn, true);
    setDisabled(switchCameraBtn, true);
    setDisabled(zoomInBtn, true);
    setDisabled(zoomOutBtn, true);
    setDisabled(zoomSlider, true);

    setCameraState(false);

    setText(cameraResolution, "WAITING FOR CAMERA");
    setText(streamStatus, "Disconnected");
    setText(continuousStatus, "Disabled");
    setText(scanMode, "Not running");

    setScanningStatus("STANDBY");
    videoWrap?.classList.remove("camera-active");

    clearOverlay();

    setAlert(
        "neutral",
        "Scan stopped",
        "The camera has been disconnected.",
        "STANDBY"
    );

    setAnalysis(
        "neutral",
        "Waiting for scan",
        "Start the camera to inspect visible objects."
    );

    setText(detectionType, "No active scan");
    setText(resultText, "Start live scan to inspect the camera feed.");
    setText(detectionState, "IDLE");
    setScanScore(0);
}

/* -------------------- CAMERA SWITCHING -------------------- */

async function switchCamera() {
    if (!running) return;

    currentFacingMode =
        currentFacingMode === "environment"
            ? "user"
            : "environment";

    stopScan();
    await startCamera();
}

/* -------------------- ZOOM -------------------- */

async function configureZoom() {
    nativeZoomSupported = false;
    currentZoom = 1;

    if (!videoTrack || !zoomSlider) return;

    let capabilities = {};

    try {
        capabilities = videoTrack.getCapabilities?.() || {};
    } catch (_) {}

    const zoom = capabilities.zoom;

    if (
        zoom &&
        Number.isFinite(zoom.min) &&
        Number.isFinite(zoom.max)
    ) {
        nativeZoomSupported = true;

        zoomSlider.min = Math.max(1, zoom.min);
        zoomSlider.max = Math.min(zoom.max, 6);
        zoomSlider.step = zoom.step || 0.1;
        zoomSlider.value = zoomSlider.min;

        currentZoom = Number(zoomSlider.value);
        setText(zoomMessage, "Hardware zoom available.");
    } else {
        zoomSlider.min = 1;
        zoomSlider.max = 3;
        zoomSlider.step = 0.1;
        zoomSlider.value = 1;

        setText(zoomMessage, "Using digital preview zoom.");
    }

    setDisabled(zoomSlider, false);
    setDisabled(zoomInBtn, false);
    setDisabled(zoomOutBtn, false);

    updateZoomDisplay();
}

async function setZoom(value) {
    if (!running || !zoomSlider) return;

    const min = Number(zoomSlider.min) || 1;
    const max = Number(zoomSlider.max) || 3;

    currentZoom = Math.max(
        min,
        Math.min(max, Number(value))
    );

    zoomSlider.value = currentZoom;

    if (nativeZoomSupported && videoTrack) {
        try {
            await videoTrack.applyConstraints({
                advanced: [{ zoom: currentZoom }]
            });

            video.style.transform = "";
        } catch (error) {
            console.warn("Hardware zoom unavailable:", error);
            nativeZoomSupported = false;
            video.style.transform = `scale(${currentZoom})`;
        }
    } else if (video) {
        video.style.transform = `scale(${currentZoom})`;
    }

    updateZoomDisplay();
}

function updateZoomDisplay() {
    setText(zoomValue, `${Number(currentZoom).toFixed(1)}×`);
}

/* -------------------- CAPTURE FRAME -------------------- */

async function captureFrame() {
    if (
        !running ||
        !video ||
        video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
        throw new Error("Camera frame is not ready.");
    }

    const originalWidth = video.videoWidth;
    const originalHeight = video.videoHeight;

    if (!originalWidth || !originalHeight) {
        throw new Error("Camera has not provided a usable frame.");
    }

    const scale = Math.min(1, MAX_FRAME_WIDTH / originalWidth);

    frameCanvas.width = Math.max(1, Math.round(originalWidth * scale));
    frameCanvas.height = Math.max(1, Math.round(originalHeight * scale));

    frameContext.drawImage(
        video,
        0,
        0,
        frameCanvas.width,
        frameCanvas.height
    );

    const blob = await new Promise(resolve => {
        frameCanvas.toBlob(
            resolve,
            "image/jpeg",
            JPEG_QUALITY
        );
    });

    if (!blob) {
        throw new Error("Could not capture a camera frame.");
    }

    return {
        blob,
        originalWidth,
        originalHeight,
        uploadedWidth: frameCanvas.width,
        uploadedHeight: frameCanvas.height
    };
}

/* -------------------- YOLO API -------------------- */

async function postFrame(frame) {
    const formData = new FormData();

    // This field name matches FastAPI's UploadFile = File(...).
    formData.append("file", frame.blob, "camera-frame.jpg");

    const response = await fetch(DETECT_ENDPOINT, {
        method: "POST",
        body: formData,
        cache: "no-store"
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            body.detail ||
            body.message ||
            `Detection failed: HTTP ${response.status}`
        );
    }

    return body;
}

async function detectCameraObjects(frame) {
    const body = await postFrame(frame);

    const raw =
        body.detections ??
        body.predictions ??
        body.results ??
        [];

    if (!Array.isArray(raw)) {
        throw new Error(
            "Invalid backend response: detections must be an array."
        );
    }

    const widthRatio =
        frame.originalWidth / frame.uploadedWidth;

    const heightRatio =
        frame.originalHeight / frame.uploadedHeight;

    const detections = raw.map(item => {
        const className = getClassName(item);
        const confidence = getConfidence(item);

        let bbox =
            item.bbox ??
            item.box ??
            item.xyxy ??
            null;

        if (bbox && !Array.isArray(bbox) && typeof bbox === "object") {
            const x1 = Number(bbox.x1 ?? bbox.x ?? bbox.left ?? 0);
            const y1 = Number(bbox.y1 ?? bbox.y ?? bbox.top ?? 0);

            bbox = [
                x1,
                y1,
                Number(bbox.x2 ?? x1 + Number(bbox.width ?? 0)),
                Number(bbox.y2 ?? y1 + Number(bbox.height ?? 0))
            ];
        }

        if (Array.isArray(bbox) && bbox.length >= 4) {
            bbox = [
                Number(bbox[0]) * widthRatio,
                Number(bbox[1]) * heightRatio,
                Number(bbox[2]) * widthRatio,
                Number(bbox[3]) * heightRatio
            ];
        } else {
            bbox = null;
        }

        return {
            class: className,
            confidence,
            bbox,
            cameraLike: isCameraLabel(className),
            cameraDetection:
                isCameraLabel(className) &&
                confidence >= confidenceThreshold(className),
            hiddenCameraCandidate:
                item.hidden_camera_candidate === true ||
                item.hiddenCameraCandidate === true ||
                isHiddenCameraLabel(className)
        };
    });

    // Print actual predictions to DevTools for troubleshooting.
    console.log("YOLO detections:", detections);
    console.log("YOLO response:", body);

    return {
        detections,
        backendStatus: body.status || "completed",
        message: body.message || ""
    };
}

/* -------------------- FRAME CONFIRMATION -------------------- */

function updateFrameConfirmation(candidates) {
    const frameMap = new Map();

    for (const item of candidates) {
        const key = normalizeLabel(item.class);
        const previous = frameMap.get(key);

        if (!previous || item.confidence > previous.confidence) {
            frameMap.set(key, item);
        }
    }

    recentCameraFrames.push(frameMap);

    if (recentCameraFrames.length > FRAME_HISTORY_LIMIT) {
        recentCameraFrames.shift();
    }

    const confirmed = [];

    for (const item of candidates) {
        const key = normalizeLabel(item.class);

        const hits = recentCameraFrames.reduce(
            (count, frame) => count + (frame.has(key) ? 1 : 0),
            0
        );

        if (hits >= MIN_FRAMES_TO_CONFIRM) {
            confirmed.push(item);
        }
    }

    return confirmed;
}

/* -------------------- RED DETECTION BOXES -------------------- */

function resizeOverlay() {
    if (!overlay || !videoWrap) return;

    const rect = videoWrap.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);

    if (width > 0 && height > 0) {
        if (overlay.width !== width) overlay.width = width;
        if (overlay.height !== height) overlay.height = height;
    }
}

function clearOverlay() {
    if (!overlayContext || !overlay) return;

    overlayContext.clearRect(
        0,
        0,
        overlay.width,
        overlay.height
    );
}

function drawDetections(detections) {
    if (!overlayContext || !overlay || !video || !videoWrap) {
        return;
    }

    resizeOverlay();
    clearOverlay();

    if (!running || !video.videoWidth || !video.videoHeight) {
        return;
    }

    const scale = Math.min(
        overlay.width / video.videoWidth,
        overlay.height / video.videoHeight
    );

    const offsetX =
        (overlay.width - video.videoWidth * scale) / 2;

    const offsetY =
        (overlay.height - video.videoHeight * scale) / 2;

    for (const item of detections) {
        if (!item.bbox) continue;

        const [x1, y1, x2, y2] = item.bbox;

        const x = offsetX + x1 * scale;
        const y = offsetY + y1 * scale;
        const width = (x2 - x1) * scale;
        const height = (y2 - y1) * scale;

        if (
            ![x, y, width, height].every(Number.isFinite) ||
            width <= 0 ||
            height <= 0
        ) {
            continue;
        }

        // Every detected object receives a RED bounding box.
        overlayContext.strokeStyle = "#ff0000";
        overlayContext.lineWidth = 3;
        overlayContext.strokeRect(x, y, width, height);

        const label =
            `${item.class} ${Math.round(item.confidence * 100)}%`;

        overlayContext.font = "bold 13px Arial";

        const textWidth =
            overlayContext.measureText(label).width;

        const labelHeight = 23;
        const labelY = Math.max(0, y - labelHeight);

        overlayContext.fillStyle = "#ff0000";

        overlayContext.fillRect(
            x,
            labelY,
            textWidth + 14,
            labelHeight
        );

        overlayContext.fillStyle = "#ffffff";
        overlayContext.textBaseline = "middle";

        overlayContext.fillText(
            label,
            x + 7,
            labelY + labelHeight / 2
        );
    }
}

/* -------------------- SAVE ALERT -------------------- */

async function saveAlert(status, score, details) {
    try {
        await apiRequest(ALERTS_API, {
            method: "POST",
            body: JSON.stringify({
                status,
                score: Math.round(score),
                details
            })
        });

        await loadHistory();
    } catch (error) {
        console.error("Could not save alert:", error);

        setText(
            historyMessage,
            `Alert save failed: ${formatError(error)}`
        );
    }
}

/* -------------------- CONFIRMED CAMERA DETECTION -------------------- */

async function handleCameraDetection(detections) {
    if (!detections.length) return;

    const best = [...detections].sort(
        (a, b) => b.confidence - a.confidence
    )[0];

    const className = normalizeLabel(best.class);
    const percent = Math.round(best.confidence * 100);
    const isHidden = isHiddenCameraLabel(className);

    const alertKey = `${className}:${Math.round(best.confidence * 10)}`;

    setAlert(
        isHidden ? "danger" : "warning",
        isHidden
            ? "POSSIBLE HIDDEN-CAMERA MATCH"
            : "CAMERA-LIKE OBJECT DETECTED",
        `The model detected "${best.class}" at ${percent}% confidence across multiple frames. Inspect it physically; this prediction is not proof of a hidden camera.`,
        "MANUAL REVIEW"
    );

    setAnalysis(
        isHidden ? "danger" : "warning",
        isHidden
            ? "Possible hidden-camera match"
            : "Camera-like object found",
        "The model prediction repeated across frames. False positives are possible."
    );

    setText(detectionType, best.class);

    setText(
        resultText,
        `${percent}% model confidence. Repeated detection confirmed.`
    );

    setText(detectionState, "REVIEW");
    setScanScore(percent);

    const now = Date.now();

    if (
        now - lastAlertAt >= ALERT_COOLDOWN_MS ||
        alertKey !== lastAlertKey
    ) {
        lastAlertAt = now;
        lastAlertKey = alertKey;

        await saveAlert(
            isHidden ? "WARNING" : "INFO",
            percent,
            `${isHidden ? "Possible hidden camera" : "Camera-like object"}: ${best.class}; confidence ${percent}%; repeated detection. Manual verification required.`
        );
    }
}

/* -------------------- LIVE SCAN LOOP -------------------- */

async function scanLoop() {
    if (!running || scanning) return;

    scanning = true;

    try {
        const frame = await captureFrame();

        if (!running) return;

        const result = await detectCameraObjects(frame);

        if (!running) return;

        const detections = result.detections;

        detectorAvailable = true;
        lastDetections = detections;

        setText(modelStatus, "YOLO model responding");
        setText(headerStatus, "DETECTION AVAILABLE");
        headerDot?.classList.remove("offline");

        const candidates = detections.filter(
            item => item.cameraDetection && passesCameraThreshold(item)
        );

        const confirmed = updateFrameConfirmation(candidates);

        // Draw all model detections, including non-camera objects.
        drawDetections(detections);

        if (confirmed.length > 0) {
            await handleCameraDetection(confirmed);
        } else if (candidates.length > 0) {
            const best = [...candidates].sort(
                (a, b) => b.confidence - a.confidence
            )[0];

            const percent = Math.round(best.confidence * 100);

            const hits = recentCameraFrames.reduce(
                (count, frame) =>
                    count + (
                        frame.has(normalizeLabel(best.class)) ? 1 : 0
                    ),
                0
            );

            setAlert(
                "warning",
                "Possible camera-like object — verifying",
                `The model predicted "${best.class}" at ${percent}% confidence. Checking repeated frames before raising an alert.`,
                "VERIFYING"
            );

            setAnalysis(
                "warning",
                "Checking repeated detections",
                `Detected in ${hits} of the last ${FRAME_HISTORY_LIMIT} frames.`
            );

            setText(detectionType, `Possible ${best.class}`);

            setText(
                resultText,
                `Model confidence: ${percent}%. Waiting for confirmation.`
            );

            setText(detectionState, "VERIFYING");
            setScanScore(percent);
        } else {
            setAlert(
                "neutral",
                "Live scan running",
                "No camera-class prediction passed the confidence threshold in this frame. This does not prove the area is free of hidden cameras.",
                "MONITORING"
            );

            setAnalysis(
                "neutral",
                "Analyzing visible objects",
                detections.length
                    ? `${detections.length} object(s) detected. None passed the camera-class filter.`
                    : "No objects returned by the model in this frame. Try better lighting or test a known dataset image."
            );

            setText(
                detectionType,
                detections.length
                    ? "No qualifying camera candidate"
                    : "No objects detected"
            );

            setText(
                resultText,
                detections.length
                    ? `${detections.length} object(s) returned by YOLO.`
                    : "The model returned an empty detection list."
            );

            setText(detectionState, "SCANNING");
            setScanScore(0);
        }

        setText(lastScanTime, new Date().toLocaleTimeString());
        setScanningStatus("SCANNING");
    } catch (error) {
        console.error("Live detection failed:", error);

        setAlert(
            "warning",
            "Detection request failed",
            formatError(error),
            "SCAN ERROR"
        );

        setAnalysis(
            "warning",
            "Detection unavailable",
            "The camera may be working, but the backend failed to process this frame."
        );

        setText(detectionType, "Detection error");
        setText(resultText, formatError(error));
        setText(detectionState, "ERROR");
    } finally {
        scanning = false;

        if (running) {
            scanTimer = setTimeout(scanLoop, SCAN_INTERVAL_MS);
        }
    }
}

/* -------------------- ALERT HISTORY -------------------- */

async function loadHistory() {
    if (!historyBody) return;

    const generation = ++historyRequestGeneration;

    try {
        const data = await apiRequest(ALERTS_API);

        if (generation !== historyRequestGeneration) return;

        const alerts = Array.isArray(data)
            ? data
            : (data.alerts ?? data.items ?? []);

        historyBody.replaceChildren();

        if (!alerts.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");

            cell.colSpan = 4;
            cell.className = "empty-history";
            cell.textContent = "No alerts recorded yet.";

            row.appendChild(cell);
            historyBody.appendChild(row);

            setText(historyMessage, "No saved alerts.");
            return;
        }

        for (const alert of alerts) {
            const row = document.createElement("tr");

            const details = typeof alert.details === "string"
                ? alert.details
                : JSON.stringify(alert.details ?? "");

            const values = [
                alert.created_at || alert.timestamp
                    ? new Date(
                        alert.created_at ?? alert.timestamp
                    ).toLocaleString()
                    : "Unknown",
                alert.status ?? "INFO",
                alert.score == null ? "—" : `${alert.score}%`,
                details
            ];

            for (const value of values) {
                const cell = document.createElement("td");
                cell.textContent = String(value);
                row.appendChild(cell);
            }

            historyBody.appendChild(row);
        }

        setText(historyMessage, `${alerts.length} saved record(s).`);
    } catch (error) {
        if (generation !== historyRequestGeneration) return;

        console.warn("Could not load alert history:", error);

        setText(
            historyMessage,
            `History unavailable: ${formatError(error)}`
        );
    }
}

/* -------------------- CLEAR HISTORY -------------------- */

async function clearHistory() {
    if (!confirm("Delete all saved scan alerts?")) return;

    try {
        await apiRequest(ALERTS_API, {
            method: "DELETE"
        });

        await loadHistory();

        setText(historyMessage, "History cleared.");
    } catch (error) {
        console.error("Could not clear history:", error);

        setText(
            historyMessage,
            `Could not clear history: ${formatError(error)}`
        );
    }
}

/* -------------------- BUTTON EVENTS -------------------- */

startBtn?.addEventListener("click", startCamera);
stopBtn?.addEventListener("click", stopScan);
switchCameraBtn?.addEventListener("click", switchCamera);

zoomInBtn?.addEventListener("click", () => {
    setZoom(Number(zoomSlider?.value || 1) + 0.2);
});

zoomOutBtn?.addEventListener("click", () => {
    setZoom(Number(zoomSlider?.value || 1) - 0.2);
});

zoomSlider?.addEventListener("input", event => {
    setZoom(event.target.value);
});

refreshBtn?.addEventListener("click", loadHistory);
clearBtn?.addEventListener("click", clearHistory);

window.addEventListener("resize", () => {
    if (running) drawDetections(lastDetections);
});

window.addEventListener("beforeunload", () => {
    running = false;

    if (scanTimer) clearTimeout(scanTimer);

    stopCameraTracks();
});

/* -------------------- INITIALIZE -------------------- */

setDisabled(stopBtn, true);
setDisabled(switchCameraBtn, true);
setDisabled(zoomInBtn, true);
setDisabled(zoomOutBtn, true);
setDisabled(zoomSlider, true);

setCameraState(false);
setScanScore(0);

checkHealth();
loadHistory();
