# Start all three services in separate PowerShell terminal windows

$rootDir = $PSScriptRoot

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "Starting AI Product Label Compliance Checker Services..." -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan

# 1. Backend
Write-Host "Launching Backend (Port 5000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\backend'; Write-Host '--- BACKEND SERVER (PORT 5000) ---' -ForegroundColor Green; npm run dev"

# 2. Frontend
Write-Host "Launching Frontend (Port 5173)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\frontend'; Write-Host '--- FRONTEND VITE DEV SERVER (PORT 5173) ---' -ForegroundColor Green; npm run dev"

# 3. AI Service
Write-Host "Launching AI Service (Port 8000)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$rootDir\ai-service'; & '.\.venv\Scripts\Activate.ps1'; Write-Host '--- AI SERVICE FASTAPI (PORT 8000) ---' -ForegroundColor Green; uvicorn app:app --reload --port 8000"

Write-Host ""
Write-Host "All 3 services launched in separate terminals!" -ForegroundColor Green
Write-Host "- Frontend: http://localhost:5173"
Write-Host "- Backend:  http://localhost:5000/api/health"
Write-Host "- AI OCR:   http://localhost:8000/docs"

