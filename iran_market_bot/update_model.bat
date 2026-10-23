@echo off
chcp 65001 >nul
cd /d "%~dp0"
set NO_PROXY=tsetmc.com,cdn.tsetmc.com
python -c "import pandas as pd; from sources import market as M; M.market_watch().to_pickle('data/bt/mw.pkl')" || goto :err
python backtest\fetch_data.py || goto :err
python -m backtest.train || goto :err
echo.
echo مدل به‌روز شد.
pause
exit /b 0
:err
echo خطا در به‌روزرسانی مدل.
pause
