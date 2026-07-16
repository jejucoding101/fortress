@echo off
setlocal

cd /d "%~dp0"

echo [fortress2-clone] Checking ports 3000 and 5173...
for %%P in (3000 5173) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr /r /c:":%%P .*LISTENING"') do (
    echo [fortress2-clone] Closing process %%A on port %%P...
    taskkill /PID %%A /F >nul 2>nul
  )
)

echo [fortress2-clone] Starting server and client...
call npm run dev

endlocal
