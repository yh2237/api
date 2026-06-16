#!/bin/sh
cd "$(dirname "$0")" || exit 1

pm2 stop api-server && echo "pm2: api-server stopped" || echo "pm2: api-server not running"
