#!/bin/sh
set -e
echo "Running database migrations..."
node dist/db/migrate.js
echo "Starting GARR API server..."
exec node dist/server.js
