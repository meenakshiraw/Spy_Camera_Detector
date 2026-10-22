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
