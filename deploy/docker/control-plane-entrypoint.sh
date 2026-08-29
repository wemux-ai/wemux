#!/bin/sh
set -eu

# 品牌迁移兼容窗口：WEMUX_* 优先，映射到 VIBEMUX_* 供本脚本与旧读取点使用；旧前缀仍可直接设置。
for _wemux_var in $(env | sed -n 's/^\(WEMUX_[A-Z0-9_]*\)=.*/\1/p'); do
  _legacy_var="VIBEMUX_${_wemux_var#WEMUX_}"
  eval "export $_legacy_var=\"\$$_wemux_var\""
done
unset _wemux_var _legacy_var

if [ "${VIBEMUX_BUNDLED_POSTGRES_ENABLED:-true}" != "false" ]; then
  export PGDATA="${VIBEMUX_POSTGRES_DATA_DIR:-/var/lib/postgresql/data}"
  export VIBEMUX_POSTGRES_PORT="${VIBEMUX_POSTGRES_PORT:-5432}"
  export VIBEMUX_POSTGRES_LOG_FILE="${VIBEMUX_POSTGRES_LOG_FILE:-$PGDATA/postgres.log}"
  database_url_db="$(node -e 'try { const url = new URL(process.env.DATABASE_URL || ""); if (["127.0.0.1", "localhost", "postgres"].includes(url.hostname)) process.stdout.write(decodeURIComponent(url.pathname.slice(1))) } catch {}')"
  export POSTGRES_DB="${POSTGRES_DB:-${database_url_db:-vibemux}}"
  export POSTGRES_USER="${POSTGRES_USER:-vibemux}"
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD}"

  case "$POSTGRES_DB" in
    ''|*[!A-Za-z0-9_]*)
      echo "[entrypoint] invalid POSTGRES_DB: $POSTGRES_DB" >&2
      exit 1
      ;;
  esac

  case "$POSTGRES_USER" in
    ''|*[!A-Za-z0-9_]*)
      echo "[entrypoint] invalid POSTGRES_USER: $POSTGRES_USER" >&2
      exit 1
      ;;
  esac

  POSTGRES_BIN_DIR="${VIBEMUX_POSTGRES_BIN_DIR:-$(dirname "$(find /usr/lib/postgresql -maxdepth 3 -type f -name initdb | sort -V | tail -n 1)")}"

  install -d -m 0700 -o postgres -g postgres "$PGDATA"
  install -d -m 0775 -o postgres -g postgres /var/run/postgresql
  if [ ! -s "$PGDATA/PG_VERSION" ]; then
    echo "[entrypoint] initializing bundled Postgres at $PGDATA"
    gosu postgres "$POSTGRES_BIN_DIR/initdb" -D "$PGDATA" --encoding=UTF8 --locale=C.UTF-8 --auth-local=trust --auth-host=scram-sha-256 >/dev/null
    echo "listen_addresses = '127.0.0.1'" >> "$PGDATA/postgresql.conf"
    echo "port = $VIBEMUX_POSTGRES_PORT" >> "$PGDATA/postgresql.conf"
  fi

  if [ -f "$PGDATA/postmaster.pid" ]; then
    postmaster_pid="$(sed -n '1p' "$PGDATA/postmaster.pid" 2>/dev/null || true)"
    if [ -n "$postmaster_pid" ] && ! kill -0 "$postmaster_pid" 2>/dev/null; then
      echo "[entrypoint] removing stale Postgres pid file from $PGDATA/postmaster.pid"
      rm -f "$PGDATA/postmaster.pid"
    fi
  fi

  echo "[entrypoint] starting bundled Postgres"
  if ! gosu postgres "$POSTGRES_BIN_DIR/pg_ctl" -D "$PGDATA" -l "$VIBEMUX_POSTGRES_LOG_FILE" -o "-p $VIBEMUX_POSTGRES_PORT" -w start >/dev/null; then
    echo "[entrypoint] bundled Postgres failed to start, recent log output:" >&2
    tail -n 120 "$VIBEMUX_POSTGRES_LOG_FILE" >&2 || true
    exit 1
  fi

  escaped_password=$(printf '%s' "$POSTGRES_PASSWORD" | sed "s/'/''/g")
  ensure_database() {
    database_name="$1"
    case "$database_name" in
      ''|*[!A-Za-z0-9_]*)
        echo "[entrypoint] invalid database name: $database_name" >&2
        exit 1
        ;;
    esac

    if ! gosu postgres psql -p "$VIBEMUX_POSTGRES_PORT" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '$database_name'" | grep -q 1; then
      echo "[entrypoint] creating bundled Postgres database $database_name"
      gosu postgres psql -p "$VIBEMUX_POSTGRES_PORT" -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$database_name\" OWNER \"$POSTGRES_USER\"" >/dev/null
    fi
  }

  if ! gosu postgres psql -p "$VIBEMUX_POSTGRES_PORT" -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = '$POSTGRES_USER'" | grep -q 1; then
    gosu postgres psql -p "$VIBEMUX_POSTGRES_PORT" -d postgres -v ON_ERROR_STOP=1 -c "CREATE ROLE \"$POSTGRES_USER\" LOGIN PASSWORD '$escaped_password'" >/dev/null
  else
    gosu postgres psql -p "$VIBEMUX_POSTGRES_PORT" -d postgres -v ON_ERROR_STOP=1 -c "ALTER ROLE \"$POSTGRES_USER\" WITH LOGIN PASSWORD '$escaped_password'" >/dev/null
  fi

  ensure_database "$POSTGRES_DB"
  if [ -n "$database_url_db" ] && [ "$database_url_db" != "$POSTGRES_DB" ]; then
    ensure_database "$database_url_db"
  fi

  if [ -z "${DATABASE_URL:-}" ]; then
    export DATABASE_URL="postgres://$POSTGRES_USER:$POSTGRES_PASSWORD@127.0.0.1:$VIBEMUX_POSTGRES_PORT/$POSTGRES_DB"
  elif echo "$DATABASE_URL" | grep -Eq '@postgres(:|/)'; then
    export DATABASE_URL="$(printf '%s' "$DATABASE_URL" | sed -E "s/@postgres(:[0-9]+)?\\//@127.0.0.1:$VIBEMUX_POSTGRES_PORT\\//")"
  fi
fi

if [ "${VIBEMUX_BUNDLED_OBJECT_STORAGE_ENABLED:-true}" != "false" ]; then
  export OBJECT_STORAGE_BUCKET="${OBJECT_STORAGE_BUCKET:-vibemux}"
  export OBJECT_STORAGE_ACCESS_KEY_ID="${OBJECT_STORAGE_ACCESS_KEY_ID:?set OBJECT_STORAGE_ACCESS_KEY_ID}"
  export OBJECT_STORAGE_SECRET_ACCESS_KEY="${OBJECT_STORAGE_SECRET_ACCESS_KEY:?set OBJECT_STORAGE_SECRET_ACCESS_KEY}"
  export VIBEMUX_OBJECT_STORAGE_PORT="${VIBEMUX_OBJECT_STORAGE_PORT:-9000}"
  export VIBEMUX_OBJECT_STORAGE_CONSOLE_PORT="${VIBEMUX_OBJECT_STORAGE_CONSOLE_PORT:-9001}"
  export VIBEMUX_OBJECT_STORAGE_DATA_DIR="${VIBEMUX_OBJECT_STORAGE_DATA_DIR:-/var/lib/vibemux/object-storage}"

  case "$OBJECT_STORAGE_BUCKET" in
    ''|*/*|*\\*)
      echo "[entrypoint] invalid OBJECT_STORAGE_BUCKET: $OBJECT_STORAGE_BUCKET" >&2
      exit 1
      ;;
  esac

  install -d -m 0700 "$VIBEMUX_OBJECT_STORAGE_DATA_DIR"

  export MINIO_ROOT_USER="$OBJECT_STORAGE_ACCESS_KEY_ID"
  export MINIO_ROOT_PASSWORD="$OBJECT_STORAGE_SECRET_ACCESS_KEY"

  echo "[entrypoint] starting bundled object storage at $VIBEMUX_OBJECT_STORAGE_DATA_DIR"
  minio server "$VIBEMUX_OBJECT_STORAGE_DATA_DIR" \
    --address "127.0.0.1:$VIBEMUX_OBJECT_STORAGE_PORT" \
    --console-address "127.0.0.1:$VIBEMUX_OBJECT_STORAGE_CONSOLE_PORT" &

  until mc alias set bundled "http://127.0.0.1:$VIBEMUX_OBJECT_STORAGE_PORT" "$OBJECT_STORAGE_ACCESS_KEY_ID" "$OBJECT_STORAGE_SECRET_ACCESS_KEY" >/dev/null 2>&1; do
    sleep 1
  done

  mc mb --ignore-existing "bundled/$OBJECT_STORAGE_BUCKET" >/dev/null
  export OBJECT_STORAGE_ENDPOINT="http://127.0.0.1:$VIBEMUX_OBJECT_STORAGE_PORT"
fi

exec "$@"
