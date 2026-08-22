# Terminal 1 — Backend
cd "e:\hackthon 7 days\backend"
docker compose up -d db redis
.\venv\Scripts\uvicorn app.main:app --reload --port 8000

# Terminal 2 — Frontend  
cd "e:\hackthon 7 days\frontend"
npm run dev
