@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"

if not exist "%PYTHON_EXE%" (
    echo Virtual environment not found. Run install.bat first.
    exit /b 1
)

if not exist "%~dp0data\real\unsw_train.csv" (
    echo Missing file: data\real\unsw_train.csv
    exit /b 1
)

if not exist "%~dp0data\real\unsw_test.csv" (
    echo Missing file: data\real\unsw_test.csv
    exit /b 1
)

echo.
echo Training UNSW-NB15 ensemble model...
"%PYTHON_EXE%" scripts\train_ensemble_unsw_nb15.py
if %ERRORLEVEL% neq 0 (
    echo Error training model
    exit /b 1
)

echo UNSW-NB15 model training completed!
pause
