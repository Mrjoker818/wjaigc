#!/usr/bin/env bash
set -euo pipefail

# Skip doctor checks in sandbox environment (secrets managed by platform)
# Just start the production server directly
exec pnpm run start
