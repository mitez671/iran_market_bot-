#!/data/data/com.termux/files/usr/bin/sh
# اجرا:  sh start-termux.sh
cd "$(dirname "$0")/server" && exec node server.mjs "$@"
