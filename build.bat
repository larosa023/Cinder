@echo off
rem Builds a single Cinder.exe in the dist folder.
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  py -3 -m venv .venv || python -m venv .venv
)
.venv\Scripts\python -m pip install --upgrade pip >nul
.venv\Scripts\python -m pip install -r requirements.txt pyinstaller
.venv\Scripts\pyinstaller --noconfirm --clean --onefile --noconsole ^
  --name Cinder ^
  --add-data "ui;ui" ^
  --add-data "themes;themes" ^
  main.py
echo.
echo Done: dist\Cinder.exe
pause
