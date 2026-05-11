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

Recommended path: Docker.

```bash
docker compose up -d --build
```

Set these env vars on the host:

- `PORT`
- `WUJIE_DATA_DIR`
- `WUJIE_AUTH_SECRET`
- `WUJIE_ADMIN_USERNAME`
- `WUJIE_ADMIN_PASSWORD`
- `APIMART_API_KEY`
- `GEMINI_API_KEY`

Mount persistent storage to `/data` so user files survive restarts.

## Notes

- Local mode uses `./data` by default.
- Cloud mode can use `/data` or any mounted persistent path via `WUJIE_DATA_DIR`.
- The production server listens on `PORT` and defaults to `5000`.
