#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
base="$root/.dev-db"
data="$base/data"
socket="$base/socket"
secret="$base/password"
port="${CORTES_EB_DEV_DB_PORT:-54329}"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"

if [[ -z "$bin" ]]; then
  echo "PostgreSQL não encontrado em /usr/lib/postgresql" >&2
  exit 1
fi

url() {
  printf 'postgresql://cortes:%s@127.0.0.1:%s/%s\n' "$(cat "$secret")" "$port" "$1"
}

case "${1:-start}" in
  start)
    mkdir -p "$socket"
    chmod 700 "$base"
    if [[ ! -d "$data" ]]; then
      umask 077
      head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' > "$secret"
      "$bin/initdb" -D "$data" -U cortes --pwfile="$secret" --auth-local=scram-sha-256 --auth-host=scram-sha-256 -E UTF8 >/dev/null
    fi
    if ! "$bin/pg_ctl" -D "$data" status >/dev/null 2>&1; then
      "$bin/pg_ctl" -D "$data" -l "$base/postgres.log" -o "-p $port -k $socket -c listen_addresses=127.0.0.1" start >/dev/null
    fi
    for name in cortes_eb cortes_eb_test; do
      PGPASSWORD="$(cat "$secret")" "$bin/psql" -h 127.0.0.1 -p "$port" -U cortes -d postgres -tAc "select 1 from pg_database where datname = '$name'" | grep -q 1 \
        || PGPASSWORD="$(cat "$secret")" "$bin/createdb" -h 127.0.0.1 -p "$port" -U cortes "$name"
    done
    url cortes_eb
    ;;
  url)
    url "${2:-cortes_eb}"
    ;;
  stop)
    "$bin/pg_ctl" -D "$data" stop >/dev/null
    ;;
  *)
    echo "uso: scripts/dev-db.sh [start|url [banco]|stop]" >&2
    exit 1
    ;;
esac
