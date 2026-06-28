# MultiMix

Standalone local repository for the MultiMix content generation workspace.

## Local Development

```bash
npm install
npm run setup:demo
npm run dev -- --hostname 127.0.0.1 --port 3200
```

Open:

- `http://127.0.0.1:3200/`
- `http://127.0.0.1:3200/app/assets?conversation=product-chain&product=digital-human-video`

Local development auto-signs in with `demo@multimix.local`. The runtime user is stored in browser `localStorage` only.

`npm run setup:demo` creates `db/local/multimix.sqlite` from committed schema and mock data. Running it again resets the local database to the same demo workspace.

Optional local environment variables can be copied from `.env.example` into `.env.local`. `LLM_API` is reserved for a local or server-side generation proxy and must not be exposed through a `NEXT_PUBLIC_` variable.

## Data Boundary

- Mock workspace data is committed as source data under `app/assets/`.
- SQLite runtime files are generated under `db/local/` and ignored by git.
- Share demo data through schema, seed scripts, and mock source data instead of committing `.sqlite`, `.db`, or `.sqlite3` files.
- Keep service role keys, Railway tokens, Vercel tokens, and production secrets out of this repository.

## Future Backend Adapter

The current app is frontend-first with local mock data. Real services can be added behind adapters for:

- Supabase Auth
- Railway API
- generation jobs
- storage
- product/version persistence
