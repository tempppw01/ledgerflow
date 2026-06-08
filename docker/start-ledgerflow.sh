#!/bin/sh
set -eu

node /app/server/mysqlSnapshotServer.js &
api_pid=$!

nginx -g "daemon off;" &
nginx_pid=$!

stop_all() {
  kill "$api_pid" "$nginx_pid" 2>/dev/null || true
  wait "$api_pid" "$nginx_pid" 2>/dev/null || true
}

trap stop_all TERM INT

while true; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid"
    exit $?
  fi

  if ! kill -0 "$nginx_pid" 2>/dev/null; then
    wait "$nginx_pid"
    exit $?
  fi

  sleep 1
done
