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

`DATABASE_PROVIDER` controls the choices exposed during initialization:

- `auto` or unset: SQLite and MySQL are offered.
- `sqlite`: SQLite is the only permitted choice.
- `mysql`: MySQL is the only permitted choice. Initialization executes `SELECT 1` with the
  server environment's MySQL credentials before locking the selection.

The lock lives in `LEDGERFLOW_DATA_DIR`, which must be mounted as a persistent Docker volume.

## Scope of this foundation

The current application still stores business data in browser persistence. SQLite and MySQL both
support the existing remote backup snapshot flow, while the next steps define shared business
tables and route reads and writes through a server repository. This separation prevents the
provider choice from changing user data behavior before the corresponding storage implementation
exists.
