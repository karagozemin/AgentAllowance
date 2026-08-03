import { Address, Keypair, Networks } from "@stellar/stellar-sdk";
import { describe, expect, test } from "vitest";
import {
  deriveTreasuryContractId,
  deterministicTreasuryContractId,
  treasuryDeploymentSalt,
  type TreasuryDeploymentConfig,
} from "../src/index.js";

function config(): TreasuryDeploymentConfig {
  return {
    rpcUrl: "https://rpc.test",
    horizonUrl: "https://horizon.test",
    networkPassphrase: Networks.TESTNET,
    transactionSource: Keypair.random(),
    treasuryWasmHash: "27".repeat(32),
    assetContract: Address.contract(Buffer.alloc(32, 1)).toString(),
    spendingPolicy: Address.contract(Buffer.alloc(32, 2)).toString(),
    recipientPolicy: Address.contract(Buffer.alloc(32, 3)).toString(),
    delegatedSigner: Keypair.random().publicKey(),
    recipient: Keypair.random().publicKey(),
    initialSpendingLimit: 1_000_000n,
    periodLedgers: 720,
    validUntilLedger: 4_000_000,
  };
}

describe("deterministic owner treasury deployment", () => {
  test("derives a stable, wallet-specific C-account", () => {
    const current = config();
    const ownerA = Keypair.random().publicKey();
    const ownerB = Keypair.random().publicKey();
    const first = deterministicTreasuryContractId(ownerA, current);
    expect(first).toMatch(/^C[A-Z2-7]{55}$/u);
    expect(deterministicTreasuryContractId(ownerA, current)).toBe(first);
    expect(deterministicTreasuryContractId(ownerB, current)).not.toBe(first);
  });

  test("binds the salt to approved code, policies, network, and deployment source", () => {
    const current = config();
    const owner = Keypair.random().publicKey();
    const salt = treasuryDeploymentSalt(owner, current);
    expect(salt).toHaveLength(32);
    expect(treasuryDeploymentSalt(owner, { ...current, treasuryWasmHash: "28".repeat(32) })).not.toEqual(salt);
    expect(treasuryDeploymentSalt(owner, { ...current, deploymentVersion: "treasury-v2" })).not.toEqual(salt);
  });

  test("uses the official Stellar contract-ID preimage", () => {
    const current = config();
    const owner = Keypair.random().publicKey();
    const salt = treasuryDeploymentSalt(owner, current);
    expect(deriveTreasuryContractId(current.transactionSource.publicKey(), salt, Networks.TESTNET))
      .toBe(deterministicTreasuryContractId(owner, current));
  });
});
