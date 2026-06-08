# MySQL snapshot sync

This is the first production-safe MySQL integration step for LedgerFlow.

The frontend still keeps the current browser data flow. MySQL stores full finance backup snapshots so existing JSON data can be saved and restored before any table-level migration happens.

## Run the API server

```bash
MYSQL_HOST=rm-xxxx.mysql.rds.aliyuncs.com \
MYSQL_PORT=3306 \
MYSQL_USER=ledgerflow \
MYSQL_PASSWORD=change-me \
MYSQL_DATABASE=ledgerflow \
npm run server:mysql
```

The server listens on `8787` by default. Set `LEDGERFLOW_API_PORT` or `PORT` to change it.

In production, proxy frontend `/api` requests to this server. The frontend already calls same-origin `/api`.

For local Vite development, run both commands:

```bash
npm run server:mysql
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787` by default. Override it with `LEDGERFLOW_API_PROXY_TARGET` if needed.

For Docker Compose, edit `docker-compose.yml` directly and replace these values before deploying:

```yaml
MYSQL_HOST: "rm-xxxx.mysql.rds.aliyuncs.com"
MYSQL_PORT: "3306"
MYSQL_USER: "ledgerflow"
MYSQL_PASSWORD: "CHANGE_ME"
MYSQL_DATABASE: "ledgerflow"
MYSQL_SSL: "false"
```

`MYSQL_HOST` should be the Alibaba Cloud RDS internal or public endpoint. This setup does not require a local MySQL container.

```bash
docker compose up --build
```

The web container proxies `/api/*` to the `ledgerflow-api` container.

## Supported routes

- `GET /api/health`
- `POST /api/conn/test`
- `POST /api/snapshots`
- `POST /api/snapshots/upload`
- `GET /api/snapshots/latest?userId=default`

`POST /api/conn/test` accepts the existing connection config payload:

```json
{
  "config": {
    "type": "mysql",
    "host": "127.0.0.1",
    "port": 3306,
    "username": "ledgerflow",
    "password": "change-me",
    "database": "ledgerflow",
    "timeoutMs": 8000
  }
}
```

Snapshot routes use the server environment MySQL credentials, not browser-stored credentials.

## Table

The server creates this table automatically:

```sql
CREATE TABLE IF NOT EXISTS ledger_snapshots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id VARCHAR(128) NOT NULL,
  schema_version INT NOT NULL,
  payload_json JSON NOT NULL,
  checksum CHAR(64) NOT NULL,
  payload_bytes INT UNSIGNED NOT NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  exported_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uniq_ledger_snapshots_user_checksum (user_id, checksum),
  KEY idx_ledger_snapshots_user_created (user_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Migration rule

Do not delete or replace browser data during this phase. Use MySQL snapshots as a remote safety copy first. After upload and restore are stable, derive structured tables from the snapshot payload.
