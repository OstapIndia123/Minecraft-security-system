#!/bin/sh
set -e

node /app/backend/server.js &
backend_pid=$!

node /app/hub-backend/server.js &
hub_pid=$!

trap 'kill "$backend_pid" "$hub_pid"' INT TERM

wait -n "$backend_pid" "$hub_pid"
exit_code=$?

kill "$backend_pid" "$hub_pid" 2>/dev/null || true
exit "$exit_code"
