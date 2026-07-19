#!/usr/bin/env bash
set -euo pipefail

pnpm run doctor -- --production
exec pnpm run start
