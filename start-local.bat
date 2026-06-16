@echo off
setlocal

set "ROOT=%~dp0"
set "BACKEND_DIR=%ROOT%backend"
set "FRONTEND_DIR=%ROOT%frontend"

echo Starting Auto Trading Software in local paper-trading mode...
echo.

if not exist "%BACKEND_DIR%\package.json" (
  echo Backend package.json not found at "%BACKEND_DIR%".
  exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
  echo Frontend package.json not found at "%FRONTEND_DIR%".
  exit /b 1
)

start "Auto Trading Backend" cmd /k "cd /d ""%BACKEND_DIR%"" && npm run dev"
start "Auto Trading Frontend" cmd /k "cd /d ""%FRONTEND_DIR%"" && npm run dev"

echo Waiting for the frontend dev server to start...
timeout /t 5 /nobreak >nul

start "" "http://localhost:5173/dashboard"

echo.
echo Backend and frontend launch commands have been started.
echo Close the opened command windows or run stop-local.bat to stop local app processes.

endlocal
