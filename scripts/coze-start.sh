#!/usr/bin/env bash
set -euo pipefail

pnpm run doctor -- --startup
exec pnpm run start
