@echo off
REM Double-click to run Quran Reel Generator from source on Windows (auto-creates .venv).
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Setting up Python environment for the first time...
  py -3 -m venv .venv || python -m venv .venv
  if errorlevel 1 (
    echo Python 3.10+ is required. Install from https://www.python.org/downloads/
    pause
    exit /b 1
  )
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt pywebview static-ffmpeg
)
".venv\Scripts\python.exe" "scripts\app_bundle_main.py"
if errorlevel 1 (
  echo.
  echo The app could not start. Press any key to close.
  pause
)
