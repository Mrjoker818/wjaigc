#!/bin/sh
set -eu

if [ ! -s .next/BUILD_ID ] || [ ! -s .next/WUJIE_BUILD_COMPLETE ] \
  || [ "$(cat .next/BUILD_ID)" != "$(cat .next/WUJIE_BUILD_COMPLETE)" ]; then
  echo 'The Docker image does not contain a complete Next.js build.' >&2
  exit 1
fi

if [ "${WUJIE_PRESENCE_ENABLED:-}" = true ] || [ "${WUJIE_YJS_ENABLED:-}" = true ]; then
  exec node --require next/dist/server/node-environment --conditions=react-server --import tsx scripts/presence-server.ts
fi

exec node node_modules/next/dist/bin/next start -p "${PORT:-5000}" -H 0.0.0.0
