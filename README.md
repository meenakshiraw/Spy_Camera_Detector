
# Spy Camera Visual Detector

A minimal web app: browser live camera, a basic visual screening heuristic, red alerts, and inspection history stored in PostgreSQL. FastAPI serves the frontend and API from the same origin.

## Easiest setup (Docker Desktop)

1. Install and start Docker Desktop.
2. Extract this project ZIP.
3. Open PowerShell in the extracted `spy_camera_detector_simple` folder (the folder containing `docker-compose.yml`).
4. Run:

   ```powershell
   docker compose up --build
   ```

5. Open **http://localhost:8000**. The frontend is served by FastAPI; there is no separate frontend server.
6. Allow camera permission, click **Start camera**, then **Inspect frame**.
7. View saved results under **Alert history**. PostgreSQL data persists in the Docker volume `postgres_data`.

Stop with `Ctrl+C`, then optionally run `docker compose down`. To also erase the saved database, run `docker compose down -v` (this deletes all history).

## Run backend directly (PostgreSQL must already be running)

In the project root, set `DATABASE_URL` to your PostgreSQL connection string, then:

```powershell
python -m pip install -r requirements.txt
python -m uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000
```

Open http://127.0.0.1:8000. Do not run the command from inside `backend` or `frontend`; run it from the project root.

## What the detector can and cannot do

The browser processes a downscaled frame locally and flags a limited pattern of very bright, compact highlights as **possible** lens-like reflections. It does not upload or save photos/video. Only inspection result metadata is sent to the backend and stored in PostgreSQL.

**Important limitation:** this visual heuristic cannot reliably detect or confirm a hidden camera. It can miss a camera and can flag reflections, LEDs, glass, or other shiny objects. A reliable detector may require dedicated RF/IR/lens-detection hardware and manual verification. A “NO ALERT” result does not prove the room is camera-free.

## Endpoints

- `GET /api/health` — backend/database health
- `POST /api/alerts` — save an inspection result
- `GET /api/alerts` — latest inspection history
- `DELETE /api/alerts` — clear history

Camera access normally works on `localhost` or HTTPS. Browser permission is required.
=======
# 🔎 Spy Camera Detector

An AI-powered web application designed to help people visually inspect their surroundings for objects that may resemble hidden cameras. It uses a custom-trained YOLO model to analyze live camera frames and report potential detections.

## 🎯 Purpose

Hidden cameras can pose serious privacy risks in places where people expect privacy. This project aims to provide an additional visual inspection tool, especially for women staying in hotels, using dressing rooms, or visiting other private spaces.

It may help users identify suspicious camera-like objects, but it cannot guarantee that a space is free from hidden surveillance devices.

## ✨ Features

- Live camera scanning through a browser.
- AI-based detection using a trained YOLO model.
- Configurable detection confidence threshold.
- FastAPI backend for image processing.
- PostgreSQL integration for persistent data.
- Responsive, cybersecurity-themed dashboard.
- Docker Compose support for deployment.


## How It Works

1\. Camera Access and Live Scanning: The user grants camera permission and starts the live scanner to scan the surrounding environment for potential hidden cameras.

2\. Real-Time Image Capture: The frontend, built with HTML, CSS, and JavaScript, captures image frames from the camera and sends them to the FastAPI backend for analysis.

3\. AI-Powered Object Detection: The FastAPI backend processes the incoming frames using a trained YOLO model to identify objects that match the camera-related classes learned during training.

4\. Detection and Alert Generation: The backend returns detection results, including identified objects and confidence scores, to the frontend. When a potential camera is detected, the application displays the detection and generates a scanner alert.

5\. PostgreSQL Database Storage: Scan records, camera detection results, and generated alerts are saved in the PostgreSQL database, allowing the application to maintain a history of scanning activity.

6\. Dashboard Monitoring: The dashboard displays camera detection results, scanner activity, alerts, and saved scan history, helping users review potential privacy risks and monitor previous scans.

7\. Review and Verification: Users can review detected objects and investigate suspicious items. The application helps identify potential hidden cameras, but detections should be verified because AI predictions are not always accurate.

```mermaid
flowchart TD
    A[Live Camera] --> B[Capture Image Frames]
    B --> C[FastAPI Backend]
    C --> D[Trained YOLO Model]
    D --> E[Potential Camera Detections]
    E --> F[Display Results]
    C <--> G[PostgreSQL]
```

## 🛡️ Why It Can Be Useful

- **Hotels and rental rooms:** Helps users visually inspect unfamiliar surroundings.
- **Dressing rooms and changing areas:** Offers an additional privacy-checking aid.
- **Women's safety:** Provides a convenient tool for women who want to take extra precautions in private spaces.
- **Travel and accommodation:** Can support a personal privacy-check routine when away from home.

## 🛠 Technology Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Python, FastAPI, Uvicorn
- **AI/ML:** Ultralytics YOLO, PyTorch, OpenCV
- **Database:** PostgreSQL, Psycopg
- **Deployment:** Docker, Docker Compose

## 📁 Project Structure

```text
spy_camera_detector_simple/
├── backend/
├── frontend/
├── models/
│   └── best.pt
├── dataset/
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

## 🚀 Run with Docker

Prerequisites: Docker Desktop and the trained model at `models/best.pt`.

```powershell
git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
cd YOUR_REPOSITORY

Copy-Item .env.example .env

docker compose up --build -d
docker compose logs -f app
```

Open `http://localhost:8000/docs` for the API documentation. Access the frontend at the URL configured by your application.

## ⚙️ Configuration

Set these variables in `.env`:

```env
POSTGRES_DB=your_database_name
POSTGRES_USER=your_database_username
POSTGRES_PASSWORD=your_secure_password
DATABASE_URL=postgresql+psycopg://your_database_username:your_secure_password@postgres:5432/your_database_name
DETECTOR_MODEL_PATH=models/best.pt
YOLO_CONFIDENCE=0.25
```

Use `localhost` as the database hostname for local development outside Docker Compose.

## ⚠️ Important Limitations

This application detects visual patterns learned by its model. It cannot reliably identify every concealed camera, confirm whether a device is recording, or detect cameras that are outside the camera's view.

A negative scan does **not** prove that a room is safe. If you find a suspicious device, avoid tampering with it if doing so could put you at risk, and consider contacting the property manager or appropriate local authorities.

## 🔮 Future Improvements

- Improve detection accuracy using diverse, real-world training data.
- Add clearer detection overlays and scan history.
- Evaluate model precision and recall.
- Improve mobile performance and deployment reliability.


