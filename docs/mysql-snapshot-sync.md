# MySQL snapshot sync

This is the first production-safe MySQL integration step for LedgerFlow.

The frontend still keeps the current browser data flow. MySQL stores full finance backup snapshots so existing JSON data can be saved and restored before any table-level migration happens.

## Run locally

```bash
MYSQL_HOST=rm-xxxx.mysql.rds.aliyuncs.com \
MYSQL_PORT=3306 \
MYSQL_USER=ledgerflow \
MYSQL_PASSWORD=change-me \
MYSQL_DATABASE=ledgerflow \
LEDGERFLOW_API_TOKEN=replace-with-a-long-random-token \
npm run server:mysql
```

The API server listens on `8787` by default. Set `LEDGERFLOW_API_PORT` or `PORT` to change it.
All snapshot routes require `LEDGERFLOW_API_TOKEN`. Enter the same token in the MySQL snapshot panel before uploading or restoring.
The same token also protects the WebDAV same-origin proxy at `/api/webdav/*`.

For local Vite development, run both commands:

```bash
npm run server:mysql
npm run dev
```

Vite proxies `/api` to `http://127.0.0.1:8787` by default. Override it with `LEDGERFLOW_API_PROXY_TARGET` if needed.

## Docker Compose

The production image runs Nginx and the MySQL snapshot API in one container. Nginx serves the frontend on port `80` and proxies `/api/*` to the internal Node API on `127.0.0.1:8787`.

Use one service and edit `docker-compose.yml` directly before deploying:

```yaml
services:
  ledgerflow:
    image: 34v0wphix/ledgerflow:latest
    container_name: ledgerflow
    ports:
      - '18080:80'
    environment:
      LEDGERFLOW_API_PORT: '8787'
      LEDGERFLOW_MAX_BODY_BYTES: '52428800'
      LEDGERFLOW_API_TOKEN: '${LEDGERFLOW_API_TOKEN:?Set LEDGERFLOW_API_TOKEN to a long random value}'
      LEDGERFLOW_WEBDAV_ALLOWED_HOSTS: '${LEDGERFLOW_WEBDAV_ALLOWED_HOSTS:-}'
      MYSQL_HOST: 'rm-xxxx.mysql.rds.aliyuncs.com'
      MYSQL_PORT: '3306'
      MYSQL_USER: 'ledgerflow'
      MYSQL_PASSWORD: 'CHANGE_ME'
      MYSQL_DATABASE: 'ledgerflow'
      MYSQL_SSL: 'false'
    restart: unless-stopped
```

Replace these values before deploying:

```yaml
MYSQL_HOST: 'rm-xxxx.mysql.rds.aliyuncs.com'
MYSQL_PORT: '3306'
MYSQL_USER: 'ledgerflow'
MYSQL_PASSWORD: 'CHANGE_ME'
MYSQL_DATABASE: 'ledgerflow'
MYSQL_SSL: 'false'
LEDGERFLOW_API_TOKEN: 'replace-with-a-long-random-token'
LEDGERFLOW_WEBDAV_ALLOWED_HOSTS: 'dav.example.com'
```

`MYSQL_HOST` should be the Alibaba Cloud RDS internal or public endpoint. This setup does not require a local MySQL container.

```bash
docker compose up -d
```

## Supported routes

- `GET /api/health`
- `POST /api/conn/test`
- `POST /api/snapshots`
- `POST /api/snapshots/upload`
- `GET /api/snapshots/latest?userId=default`

Except for `GET /api/health`, every route requires `Authorization: Bearer <LEDGERFLOW_API_TOKEN>` or `X-LedgerFlow-Api-Token: <LEDGERFLOW_API_TOKEN>`.

`POST /api/conn/test` only checks the MySQL credentials configured in server environment variables. It intentionally ignores browser-provided host, port, username, password, or connection string values to avoid turning the API into an arbitrary network probe.

Snapshot routes also use the server environment MySQL credentials, not browser-stored credentials.

`/api/webdav/*` is a guarded same-origin WebDAV proxy. It requires `X-LedgerFlow-Api-Token`, only accepts HTTPS upstreams, rejects local/private network addresses after DNS lookup, and can be restricted further with `LEDGERFLOW_WEBDAV_ALLOWED_HOSTS`.

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
