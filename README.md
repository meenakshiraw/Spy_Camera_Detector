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

## ⚙️ How It Works

1. The user grants camera permission and starts scanning.
2. The browser captures image frames and sends them to the backend.
3. FastAPI passes the images to the trained YOLO model.
4. The model identifies objects that resemble classes learned during training.
5. Detection results are returned to the frontend for display.

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

## 📄 License

Add a suitable `LICENSE` file before publicly distributing the project.
