# Quickstart benchmark

The submission's reproducibility gate is below ten minutes from a fresh checkout with the documented
toolchains available. The clean hosted-runner measurement and the local warm-cache measurement are
reported separately so cache effects are not hidden.

## Clean GitHub-hosted runner

- Workflow: `CI`
- Commit: `7d19e927f512bfc37873fceae6dfe06a4276254e`
- Runner: GitHub-hosted `ubuntu-latest`
- Started: `2026-08-03T19:13:21Z`
- Completed: `2026-08-03T19:14:32Z`
- Wall time: `71 seconds`
- Result: success
- Run: <https://github.com/karagozemin/AgentAllowance/actions/runs/30844814475>

The workflow begins with a fresh checkout. Its two parallel jobs install Node/Rust dependencies and
run TypeScript typecheck, tests, production builds, secret scan, desktop/mobile Playwright E2E, Rust
tests, and the Stellar contract build.

## Local prerequisite script

- Command: `./scripts/quickstart-testnet.sh`
- Measured: `2026-08-03`
- Environment: macOS, dependencies and build caches already present
- Wall time: `10 seconds`
- Result: success

The local result is intentionally labeled warm-cache. The script runs workspace typecheck/tests,
builds all three contracts, generates an isolated Relayer runtime, and starts the local Relayer. It
does not fund accounts or submit a Testnet payment.
