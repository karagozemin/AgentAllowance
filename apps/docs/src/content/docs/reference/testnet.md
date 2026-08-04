---
title: Testnet addresses
description: Pinned Stellar Testnet assets, policies, services, and public proof transactions.
---

These values belong to the current public Testnet deployment. Do not reuse them for Pubnet.

## Network and contracts

| Resource | Value |
| --- | --- |
| Network | `stellar:testnet` |
| Passphrase | `Test SDF Network ; September 2015` |
| Soroban RPC | `https://soroban-testnet.stellar.org` |
| Horizon | `https://horizon-testnet.stellar.org` |
| Asset code | `USDC` |
| Asset decimals | `7` |
| USDC SAC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Spending policy | `CDB2YGZ5RL4R4K37DVBT5UGBKVLYEQJMLGPYZJUSRPS5XULH672QLJUY` |
| Recipient policy | `CBNVPB5CFXOIAGWAZOZJGOZDVGJPRG5FCNC3777R327U4NDORO4E2BT3` |
| Merchant | `GDYGNUG2DKQVRJYYMXO5AUFEMMEMW7NIOGCQZSVYVNVMS4GNROZYJ5SZ` |

Wallet-owned treasury addresses are deterministic per Freighter owner and deployment profile, so
there is no single shared owner treasury address.

## Hosted services

| Service | URL |
| --- | --- |
| dApp | [agentallowance-console.onrender.com](https://agentallowance-console.onrender.com/) |
| Merchant API | [agentallowance-demo-api.onrender.com](https://agentallowance-demo-api.onrender.com/) |
| Facilitator | `https://agentallowance-facilitator.onrender.com/api/v1/plugins/x402-facilitator/call` |

## Proven transactions

**Official Testnet USDC settlement**

[`11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3`](https://stellar.expert/explorer/testnet/tx/11232c4accb4f6cbc6b4ba9455a25642be4e8b5c9d84d98cd8250bd0970152a3)

**Hosted wallet-owner settlement**

[`449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d`](https://stellar.expert/explorer/testnet/tx/449866cb3e7b5ee4e42efa1c4387a822a494fb4df03c9fbba8c0d9445f00fa0d)

Testnet state can expire or be reset. Transaction hashes and archived evidence remain the durable
proof for the submission.
