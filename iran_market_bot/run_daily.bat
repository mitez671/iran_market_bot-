@echo off
cd /d "%~dp0"
set NO_PROXY=tsetmc.com,parseek.com,eghtesadnews.com,hamrah-mechanic.com,ahanonline.com
python main.py --daily >> reports\daily_log.txt 2>&1
