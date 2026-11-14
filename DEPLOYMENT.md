# WujieAI Deployment

## Local

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5000`.

For a production-style local run:

```bash
pnpm build
pnpm start
```

## Cloud Host

Build the Docker image, apply migrations against the configured PostgreSQL database, then start the app.

```bash
docker compose build wujieai
docker compose run --rm wujieai node scripts/run-migrations.mjs
docker compose up -d wujieai
```

Set these env vars in the Compose runtime `.env` file. `DATABASE_URL` or `PGDATABASE_URL` must point to a reachable PostgreSQL instance. Compose starts the application only.

- `DATABASE_URL` or `PGDATABASE_URL`
- `PORT`
- `WUJIE_DATA_DIR`
- `WUJIE_AUTH_SECRET`
- `INTERNAL_API_SECRET`
- `PAYMENT_TOKEN_SECRET`
- `WUJIE_ADMIN_USERNAME`
- `WUJIE_ADMIN_PASSWORD`
- `APIMART_API_KEY`
- `GEMINI_API_KEY`

For production, `WUJIE_AUTH_SECRET` (or `NEXTAUTH_SECRET`) and `PAYMENT_TOKEN_SECRET` must each contain at least 32 random characters, and `WUJIE_ADMIN_PASSWORD` must be a unique non-placeholder value. Set a separate `INTERNAL_API_SECRET` as well, so server-to-server requests do not reuse the session signing key. The application refuses to sign sessions, bootstrap an administrator, or issue payment QR tokens when required secrets are missing. Generate secrets with `openssl rand -base64 48` or an equivalent secret manager.

Mount persistent storage to `/data` so user files survive restarts. The Docker image uses this volume for uploads and bundles the font used by Chinese PDF export.

## Notes

- Local mode uses `./data` by default.
- Cloud mode can use `/data` or any mounted persistent path via `WUJIE_DATA_DIR`.
- The production server listens on `PORT` and defaults to `5000`.
