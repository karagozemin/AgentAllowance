# Submission Readiness Checklist

This file tracks release-gating work. A checked item must have either a repository artifact or a live
Testnet record; planned work is not marked complete.

## Product

- [x] Smart-account treasury with delegated context rules
- [x] Spending cap, recipient restriction, ledger expiry, and revoke
- [x] Autonomous x402 verify, settle, retry, and protected-resource unlock
- [x] Policy-aware OpenZeppelin facilitator with strict extra-event validation
- [x] Public evidence console and Freighter owner authentication
- [x] Freighter-signed create/revoke Soroban authorization path
- [x] Asset-aware console labels and atomic-unit display
- [x] Fresh official Testnet USDC deploy, block cases, and settlement evidence
- [x] Live Freighter create and revoke transaction evidence archived in
  [`owner-onboarding.json`](../evidence/testnet/2026-08-03T21-41-46-267Z-multi-wallet-onboarding/owner-onboarding.json)

## Developer experience

- [x] Independent SDK integration under `apps/x402-sdk-example`
- [x] Timed quickstart script with explicit process boundaries
- [x] Environment template and Testnet USDC preparation command
- [x] Local relayer and Render deployment guides
- [x] Successful clean hosted-runner verification recorded below ten minutes
- [x] Publish-ready `0.1.1` SDK packages, documentation, and clean-consumer tarball smoke test
- [ ] Public npm release, optional P1

## Evidence and submission

- [x] Reviewer-first evidence index
- [x] Architecture and security documents
- [x] 90-second demo runbook
- [x] Root MIT license and fork-specific AGPL license
- [x] TypeScript, Rust, production build, secret scan, desktop/mobile E2E
- [x] Final USDC transaction links and balance deltas added to README
- [ ] Hosted demo deployment confirmed on the final release commit
- [ ] Final video URL
- [ ] Clean release tag matching the deployed commit

## Current external blockers

The official Testnet USDC funding, local Relayer gates, and Freighter create/revoke evidence are
complete. Remaining external release inputs are confirmation that the hosted demo runs the final
commit, the recorded demo URL, the release tag, and npm authentication for the optional public SDK
release.
