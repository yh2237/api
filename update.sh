#!/bin/sh
set -e

cd /srv/api || exit 1

git pull
npm install
pm2 reload api-server

echo "api-server updated and reloaded"
