# Database provider foundation

This branch starts the migration from browser-only persistence to a server-owned data layer.
It does not move ledger business records yet.

## First initialization

`GET /api/setup/status` reports whether this deployment has selected a database provider.
Before the first initialization, `POST /api/setup/initialize` accepts a user confirmation without
an API token and writes a one-time provider lock to `$LEDGERFLOW_DATA_DIR/database-provider.json`.
After initialization, the endpoint requires `LEDGERFLOW_API_TOKEN` for any repeat request.

The selected provider cannot be changed in place. A change requires exporting data, deploying a
new instance with the target provider, and importing the backup into that instance.

`DATABASE_PROVIDER` controls the choices exposed during initialization. The service also reports
whether each choice has the required environment configuration before the UI enables it:

- `auto` or unset: SQLite and MySQL are offered.
- `sqlite`: SQLite is the only permitted choice.
- `mysql`: MySQL is the only permitted choice. Initialization executes `SELECT 1` with the
  server environment's MySQL credentials before locking the selection.
- SQLite is always locally configurable.
- MySQL requires `MYSQL_URL` or `MYSQL_HOST`. Without either value, MySQL is shown as unavailable
  and initialization rejects it before attempting a connection.

The lock lives in `LEDGERFLOW_DATA_DIR`, which must be mounted as a persistent Docker volume.

## Scope of this foundation

The relational repository is now the source of truth for the data-provider path. The first account
claims the existing `ledger_users.id = 'default'` row so a deployment can add authentication without
rewriting legacy business IDs. Later accounts receive independent ledger user IDs, and all business
data routes resolve the user from the HttpOnly session cookie.

The browser cache remains useful for offline recovery and legacy import/export, but it is no longer
an authority for an initialized relational deployment. The provider lock and SQLite database file
must live in persistent storage; otherwise a replacement container will require initialization again
and a new SQLite database will be empty.
