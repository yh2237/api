#!/bin/sh
cd "$(dirname "$0")" || exit 1

pm2 restart api-server && echo "api-server config reloaded" || echo "api-server not running"
