@echo off
setlocal

set "PROJECT_DIR=%~dp0"
set "PYTHON_EXE=%PROJECT_DIR%.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
	echo Virtual environment not found. Run install.bat first.
	exit /b 1
)

cd /d "%PROJECT_DIR%backend"
echo Starting Flask backend on http://localhost:5000
echo Open frontend/index.html in your browser
"%PYTHON_EXE%" app.py
