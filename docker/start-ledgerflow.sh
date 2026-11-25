#!/bin/sh
set -eu

# Nginx owns the public Railway/HTTP port. Keep the API on its private
# container port so the reverse proxy target stays stable when Railway
# injects PORT.
export LEDGERFLOW_API_PORT=8787

public_port="${PORT:-80}"
case "$public_port" in
  ''|*[!0-9]*) public_port=80 ;;
esac
if [ "$public_port" -lt 1 ] || [ "$public_port" -gt 65535 ]; then
  public_port=80
fi
# Bind the image's documented port and Railway's injected port. This keeps
# manual target-port settings at 80 compatible with Railway's PORT routing.
awk -v railway_port="$public_port" '
  $0 == "  listen 80;" {
    print "  listen 80;"
    if (railway_port != "80") print "  listen " railway_port ";"
    next
  }
  { print }
' /etc/nginx/http.d/default.conf > /tmp/ledgerflow-nginx.conf
cp /tmp/ledgerflow-nginx.conf /etc/nginx/http.d/default.conf

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
