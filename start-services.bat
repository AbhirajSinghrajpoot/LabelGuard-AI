@echo off
title AI Product Label Compliance Checker Launcher
echo ========================================================
echo Starting AI Product Label Compliance Checker Services...
echo ========================================================

echo 1. Starting Backend Service (Port 5000)...
start "Backend Service (Port 5000)" cmd /k "cd /d %~dp0backend && npm run dev"

echo 2. Starting Frontend Service (Port 5173)...
start "Frontend UI (Port 5173)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo 3. Starting Python AI Service (Port 8000)...
start "Python AI Service (Port 8000)" cmd /k "cd /d %~dp0ai-service && call .venv\Scripts\activate && uvicorn app:app --reload --port 8000"

echo.
echo ========================================================
echo Services are opening in separate terminal windows!
echo - Frontend UI:  http://localhost:5173
echo - Backend API:  http://localhost:5000/api/health
echo - AI Service:   http://localhost:8000/docs
echo ========================================================

