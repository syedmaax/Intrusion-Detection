@echo off
setlocal
cd /d "%~dp0frontend"

if exist "C:\Program Files\nodejs\npm.cmd" (
	set "PATH=C:\Program Files\nodejs;%PATH%"
)

where npm >nul 2>nul
if %ERRORLEVEL% neq 0 (
	echo npm is not installed or not in PATH.
	echo Install Node.js LTS and try again.
	exit /b 1
)

if not exist "node_modules" (
	echo Installing frontend dependencies...
	call npm install
	if %ERRORLEVEL% neq 0 (
		echo Failed to install frontend dependencies.
		exit /b 1
	)
)

echo Starting React frontend on http://localhost:5173
start "" "http://localhost:5173"
call npm run dev -- --host 0.0.0.0 --port 5173
