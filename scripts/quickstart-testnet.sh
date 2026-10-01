#!/usr/bin/env bash
set -euo pipefail

started_at=$(date +%s)
required_commands=(pnpm stellar docker)
for command_name in "${required_commands[@]}"; do
  command -v "$command_name" >/dev/null || { echo "missing command: $command_name" >&2; exit 1; }
done

if [[ ! -f .env.local ]]; then
  echo "Create .env.local from .env.example before running this script." >&2
  exit 1
fi

echo "[1/5] typecheck and tests"
pnpm typecheck
pnpm test

echo "[2/5] contract build"
pnpm run build:contracts

echo "[3/5] prepare local relayer"
pnpm run relayer:prepare

echo "[4/5] start local relayer"
pnpm run relayer:start

echo "[5/5] start the merchant API and independent SDK example in separate terminals"
elapsed=$(( $(date +%s) - started_at ))
printf 'Local prerequisites completed in %ss.\n' "$elapsed"
printf '  pnpm --filter @agentallowance/x402-demo-api start\n'
printf '  pnpm --filter @agentallowance/x402-sdk-example start\n'
