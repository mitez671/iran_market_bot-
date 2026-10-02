@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
set PY=
where py >nul 2>&1 && set PY=py -3
if "%PY%"=="" set PY=python
echo Collecting all Iranian market data (VPN should be OFF)...
%PY% main.py --once
if exist "reports\latest.html" start "" "reports\latest.html"
pause
