# MultiMix Local Data

This repository keeps demo data reproducible without committing runtime database files.

Committed:

- `db/schema.sql`: local SQLite table structure.
- `scripts/db-init.ts`: deterministic local seed command.
- `app/assets/asset-workspace-mock-data.ts`: demo conversations, products, and workshop data.

Ignored:

- `db/local/multimix.sqlite`
- `*.sqlite`
- `*.sqlite3`
- `*.db`

To rebuild the local demo database:

```bash
npm run setup:demo
```

The default local user is `demo@multimix.local`.
