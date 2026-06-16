#!/bin/sh
cd "$(dirname "$0")" || exit 1

set -a
. ./.env
set +a

pm2 start server.js \
    --name api-server \
    --log-date-format "YYYY-MM-DD HH:mm:ss" \
    --update-env \
    --output logs/pm2-out.log \
    --error logs/pm2-err.log

echo "pm2: api-server started"
pm2 status api-server
