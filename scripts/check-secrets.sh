#!/usr/bin/env bash
set -euo pipefail

if git grep -nE 'S[A-Z2-7]{55}' -- ':!proofs/stellar-x402-smart-account/**'; then
  echo "Potential Stellar secret key found in tracked files." >&2
  exit 1
fi

if git grep -nE '(X402_FACILITATOR_API_KEY|RELAYER_API_KEY|KEYSTORE_PASSPHRASE)=[A-Za-z0-9_-]{24,}' -- \
  ':!proofs/stellar-x402-smart-account/**'; then
  echo "Potential runtime secret value found in tracked files." >&2
  exit 1
fi

echo "Tracked-file secret scan passed."
