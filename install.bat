@echo off
setlocal
cd /d "%~dp0"

set "VENV_DIR=%~dp0.venv"
set "PYTHON_EXE=%VENV_DIR%\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    echo Virtual environment not found. Creating .venv...
    py -3 -m venv "%VENV_DIR%"
    if %ERRORLEVEL% neq 0 (
        python -m venv "%VENV_DIR%"
    )
    if %ERRORLEVEL% neq 0 (
        echo Error creating virtual environment. Install Python 3 and ensure py or python is in PATH.
        exit /b 1
    )
)

echo Installing Python dependencies into .venv...
"%PYTHON_EXE%" -m pip install --upgrade pip
if %ERRORLEVEL% neq 0 (
    echo Error upgrading pip
    exit /b 1
)

"%PYTHON_EXE%" -m pip install -r "%~dp0requirements.txt"
if %ERRORLEVEL% neq 0 (
    echo Error installing dependencies
    exit /b 1
)

echo.
echo Checking frontend dependencies...
if exist "C:\Program Files\nodejs\npm.cmd" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
)

where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo npm not found. Frontend dependencies will be installed when you run start_frontend.bat.
) else (
    cd /d "%~dp0frontend"
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo Warning: Failed to install frontend dependencies automatically.
        echo You can retry later with: start_frontend.bat
    )
    cd /d "%~dp0"
)

echo.
echo Dependencies installed successfully in .venv!
echo.
echo Next steps:
echo 1. Place UNSW files in data\real as unsw_train.csv and unsw_test.csv
echo 2. Train the model: "%PYTHON_EXE%" scripts\train_ensemble_unsw_nb15.py
echo 3. Start backend: start_backend.bat
echo 4. Open frontend: start_frontend.bat
echo.
echo No PowerShell activation is required.
