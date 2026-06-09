#!/bin/sh
set -e
echo "Running registry-server migrations..."
node dist/migrate.js
echo "Starting Registry Server..."
exec node dist/server.js
