import { createHash } from "node:crypto";
import {
  Account,
  Address,
  Contract,
  Horizon,
  Keypair,
  Operation,
  StrKey,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";

export type TreasuryDeploymentConfig = {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  transactionSource: Keypair;
  treasuryWasmHash: string;
  assetContract: string;
  spendingPolicy: string;
  recipientPolicy: string;
  delegatedSigner: string;
  recipient: string;
  initialSpendingLimit: bigint;
  periodLedgers: number;
  validUntilLedger: number;
  deploymentVersion?: string;
};

export type TreasuryDeploymentResult = {
  treasuryContract: string;
  transactionHash?: string;
  created: boolean;
};

function assertGAccount(value: string): void {
  Keypair.fromPublicKey(value);
}

function assertContract(value: string): void {
  const address = Address.fromString(value);
  if (address.type !== "contract") throw new Error(`${value} is not a Stellar contract address`);
}

function assertPositiveU32(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 0xffff_ffff) {
    throw new Error(`${name} must be a positive u32`);
  }
}

export function treasuryDeploymentSalt(
  owner: string,
  config: Pick<TreasuryDeploymentConfig,
    "networkPassphrase" | "transactionSource" | "treasuryWasmHash" | "assetContract" |
    "spendingPolicy" | "recipientPolicy" | "deploymentVersion">,
): Buffer {
  assertGAccount(owner);
  const wasmHash = config.treasuryWasmHash.toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(wasmHash)) throw new Error("treasuryWasmHash must be a SHA-256 hash");
  return createHash("sha256").update(JSON.stringify({
    product: "AgentAllowance",
    version: config.deploymentVersion ?? "treasury-v1",
    network: config.networkPassphrase,
    deployer: config.transactionSource.publicKey(),
    owner,
    wasmHash,
    asset: config.assetContract,
    spendingPolicy: config.spendingPolicy,
    recipientPolicy: config.recipientPolicy,
  })).digest();
}

export function deriveTreasuryContractId(
  deployer: string,
  salt: Buffer | Uint8Array,
  networkPassphrase: string,
): string {
  assertGAccount(deployer);
  if (salt.length !== 32) throw new Error("Treasury deployment salt must be 32 bytes");
  const contractIdPreimage = xdr.ContractIdPreimage.contractIdPreimageFromAddress(
    new xdr.ContractIdPreimageFromAddress({
      address: Address.fromString(deployer).toScAddress(),
      salt: Buffer.from(salt),
    }),
  );
  const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
    new xdr.HashIdPreimageContractId({
      networkId: hash(Buffer.from(networkPassphrase)),
      contractIdPreimage,
    }),
  );
  return StrKey.encodeContract(hash(preimage.toXDR()));
}

export function deterministicTreasuryContractId(owner: string, config: TreasuryDeploymentConfig): string {
  return deriveTreasuryContractId(
    config.transactionSource.publicKey(),
    treasuryDeploymentSalt(owner, config),
    config.networkPassphrase,
  );
}

function contractInstanceKey(contractId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
    contract: Address.fromString(contractId).toScAddress(),
    key: xdr.ScVal.scvLedgerKeyContractInstance(),
    durability: xdr.ContractDataDurability.persistent(),
  }));
}

export async function treasuryExists(rpcUrl: string, contractId: string): Promise<boolean> {
  const result = await new rpc.Server(rpcUrl).getLedgerEntries(contractInstanceKey(contractId));
  return result.entries.length === 1;
}

function constructorArgs(owner: string, config: TreasuryDeploymentConfig): xdr.ScVal[] {
  if (config.initialSpendingLimit <= 0n) throw new Error("initialSpendingLimit must be positive");
  assertPositiveU32(config.periodLedgers, "periodLedgers");
  assertPositiveU32(config.validUntilLedger, "validUntilLedger");
  assertGAccount(owner);
  assertGAccount(config.delegatedSigner);
  assertGAccount(config.recipient);
  for (const value of [config.assetContract, config.spendingPolicy, config.recipientPolicy]) assertContract(value);
  return [
    Address.fromString(owner).toScVal(),
    Address.fromString(config.assetContract).toScVal(),
    Address.fromString(config.delegatedSigner).toScVal(),
    Address.fromString(config.spendingPolicy).toScVal(),
    Address.fromString(config.recipientPolicy).toScVal(),
    nativeToScVal(config.initialSpendingLimit, { type: "i128" }),
    xdr.ScVal.scvU32(config.periodLedgers),
    Address.fromString(config.recipient).toScVal(),
    xdr.ScVal.scvU32(config.validUntilLedger),
  ];
}

async function submitPreparedTransaction(
  config: Pick<TreasuryDeploymentConfig, "rpcUrl" | "transactionSource">,
  transaction: ReturnType<TransactionBuilder["build"]>,
): Promise<string> {
  const server = new rpc.Server(config.rpcUrl);
  const prepared = await server.prepareTransaction(transaction);
  prepared.sign(config.transactionSource);
  const submitted = await server.sendTransaction(prepared);
  if (submitted.status === "ERROR") throw new Error(`Transaction submission failed: ${submitted.hash}`);
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const result = await server.getTransaction(submitted.hash);
    if (result.status === "SUCCESS") return submitted.hash;
    if (result.status === "FAILED") throw new Error(`Transaction failed on chain: ${submitted.hash}`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Transaction result is unknown: ${submitted.hash}`);
}

export async function deployDeterministicTreasury(
  owner: string,
  config: TreasuryDeploymentConfig,
): Promise<TreasuryDeploymentResult> {
  const treasuryContract = deterministicTreasuryContractId(owner, config);
  if (await treasuryExists(config.rpcUrl, treasuryContract)) {
    return { treasuryContract, created: false };
  }
  const source = await new Horizon.Server(config.horizonUrl).loadAccount(config.transactionSource.publicKey());
  const operation = Operation.createCustomContract({
    address: Address.fromString(config.transactionSource.publicKey()),
    wasmHash: Buffer.from(config.treasuryWasmHash, "hex"),
    salt: treasuryDeploymentSalt(owner, config),
    constructorArgs: constructorArgs(owner, config),
  });
  const transaction = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
    fee: "1000000",
    networkPassphrase: config.networkPassphrase,
  }).addOperation(operation).setTimeout(60).build();
  const transactionHash = await submitPreparedTransaction(config, transaction);
  if (!await treasuryExists(config.rpcUrl, treasuryContract)) {
    throw new Error("Treasury deployment succeeded but the deterministic contract was not found");
  }
  return { treasuryContract, transactionHash, created: true };
}

export async function fundTreasuryFromSponsor(options: {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  transactionSource: Keypair;
  assetContract: string;
  treasuryContract: string;
  amount: bigint;
}): Promise<string | undefined> {
  if (options.amount === 0n) return undefined;
  if (options.amount < 0n) throw new Error("Sponsored funding amount cannot be negative");
  const source = await new Horizon.Server(options.horizonUrl).loadAccount(options.transactionSource.publicKey());
  const operation = new Contract(options.assetContract).call(
    "transfer",
    Address.fromString(options.transactionSource.publicKey()).toScVal(),
    Address.fromString(options.treasuryContract).toScVal(),
    nativeToScVal(options.amount, { type: "i128" }),
  );
  const transaction = new TransactionBuilder(new Account(source.accountId(), source.sequenceNumber()), {
    fee: "1000000",
    networkPassphrase: options.networkPassphrase,
  }).addOperation(operation).setTimeout(60).build();
  return submitPreparedTransaction(options, transaction);
}
