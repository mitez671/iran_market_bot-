@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"
if not exist reports mkdir reports
set LOG=reports\run_log.txt
echo ===== %date% %time% ===== > %LOG%

set PY=
where py >nul 2>&1 && set PY=py -3
if "%PY%"=="" (where python >nul 2>&1 && set PY=python)
if "%PY%"=="" (
  echo Python not found. Install from python.org with "Add to PATH". >> %LOG%
  echo Python not found. Install from python.org with "Add to PATH".
  pause
  exit /b 1
)
%PY% --version >> %LOG% 2>&1

echo [1/4] Installing libraries (trying Iranian mirrors first)...
set OK=0
for %%M in (
  "https://mirror-pypi.runflare.com/simple"
  "https://package-mirror.liara.ir/repository/pypi/simple"
  "https://repo.hmirror.ir/python/simple"
  "https://pypi.org/simple"
) do (
  if !OK!==0 (
    echo --- trying mirror %%~M >> %LOG%
    echo     mirror: %%~M
    %PY% -m pip install --disable-pip-version-check --timeout 60 --retries 2 -i %%~M -r requirements.txt >> %LOG% 2>&1
    if !errorlevel!==0 (
      set OK=1
      echo --- installed OK from %%~M >> %LOG%
    )
  )
)
if !OK!==0 (
  echo ALL MIRRORS FAILED >> %LOG%
  echo Library install failed on all mirrors. See reports\run_log.txt
  pause
  exit /b 1
)

echo [2/4] Checking data sources (max ~2 min)...
%PY% check_sources.py

echo [3/4] Demo run...
%PY% main.py --demo > reports\demo_log.txt 2>&1

echo [4/4] Real run...
%PY% main.py --once

echo ===== done ===== >> %LOG%
echo.
echo Done. Report: reports\latest.html   Log: reports\run_log.txt
if exist "reports\latest.html" start "" "reports\latest.html"
pause
