@echo off
setlocal
cd /d "%~dp0"
python -B server.py --open
if errorlevel 1 pause
