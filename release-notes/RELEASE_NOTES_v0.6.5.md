# LedgerFlow v0.6.5

## Highlights

- Reworked repayment trends for compact spaces: switch between installment payments and remaining principal, then hover or tap to inspect the selected period's date and amount.
- Fixed the date picker in debt-entry dialogs so the calendar stays above the dialog and automatically chooses a visible position.
- Refined the mobile navigation into a continuous, app-like flow with less nested card treatment and clearer shortcut hierarchy.
- Rebuilt the in-app Help page as a task-based guide for bookkeeping, accounts, budget and debt planning, backup, recovery, and troubleshooting.

## Deployment notes

- This release is compatible with the current Docker image deployment and Railway setup.
- For SQLite deployments, keep `/app/data` mounted to persistent storage before upgrading.

## Validation

- `npm run build`
- Repayment management test suite

## Docker

- `34v0wphix/ledgerflow:latest`

For the complete project overview and deployment guide, see the repository README.
