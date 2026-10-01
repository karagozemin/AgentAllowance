import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AllowanceRecord, PaymentAttempt } from "@agentallowance/shared";

export interface EvidenceStore {
  putAllowance(record: AllowanceRecord): void;
  getAllowance(id: string): AllowanceRecord | undefined;
  listAllowances(): AllowanceRecord[];
  putAttempt(record: PaymentAttempt): void;
  getAttempt(id: string): PaymentAttempt | undefined;
  findAttempt(allowanceId: string, requestReference: string): PaymentAttempt | undefined;
  listAttempts(limit?: number): PaymentAttempt[];
}

function parseAllowance(row: Record<string, unknown>): AllowanceRecord {
  return {
    allowanceId: String(row.allowance_id),
    label: String(row.label),
    network: String(row.network) as AllowanceRecord["network"],
    treasuryContract: String(row.treasury_contract),
    assetContract: String(row.asset_contract),
    delegatedSigner: String(row.delegated_signer),
    maxSpendAtomic: String(row.max_spend_atomic),
    spentAtomic: String(row.spent_atomic),
    windowLedgers: Number(row.window_ledgers),
    allowedRecipients: JSON.parse(String(row.allowed_recipients)) as string[],
    validUntilLedger: Number(row.valid_until_ledger),
    contextRuleId: Number(row.context_rule_id),
    createTxHash: row.create_tx_hash ? String(row.create_tx_hash) : undefined,
    revokeTxHash: row.revoke_tx_hash ? String(row.revoke_tx_hash) : undefined,
    status: String(row.status) as AllowanceRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function parseAttempt(row: Record<string, unknown>): PaymentAttempt {
  return {
    attemptId: String(row.attempt_id),
    allowanceId: String(row.allowance_id),
    url: String(row.url),
    requestReference: String(row.request_reference),
    challengeHash: String(row.challenge_hash),
    amountAtomic: String(row.amount_atomic),
    payTo: String(row.pay_to),
    assetContract: String(row.asset_contract),
    state: String(row.state) as PaymentAttempt["state"],
    decision: String(row.decision) as PaymentAttempt["decision"],
    reasonCode: row.reason_code ? String(row.reason_code) as PaymentAttempt["reasonCode"] : undefined,
    safeDetail: row.safe_detail ? String(row.safe_detail) : undefined,
    facilitatorStatus: row.facilitator_status ? String(row.facilitator_status) : undefined,
    txHash: row.tx_hash ? String(row.tx_hash) : undefined,
    receiptHash: row.receipt_hash ? String(row.receipt_hash) : undefined,
    receipt: row.receipt_json ? JSON.parse(String(row.receipt_json)) as PaymentAttempt["receipt"] : undefined,
    responseHash: row.response_hash ? String(row.response_hash) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SqliteEvidenceStore implements EvidenceStore {
  readonly #db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.#db = new DatabaseSync(filename);
    this.#db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS allowances (
        allowance_id TEXT PRIMARY KEY, label TEXT NOT NULL, network TEXT NOT NULL,
        treasury_contract TEXT NOT NULL, asset_contract TEXT NOT NULL, delegated_signer TEXT NOT NULL,
        max_spend_atomic TEXT NOT NULL, spent_atomic TEXT NOT NULL, window_ledgers INTEGER NOT NULL,
        allowed_recipients TEXT NOT NULL, valid_until_ledger INTEGER NOT NULL, context_rule_id INTEGER NOT NULL,
        create_tx_hash TEXT, revoke_tx_hash TEXT, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(network, treasury_contract, context_rule_id)
      );
      CREATE INDEX IF NOT EXISTS allowances_signer_status ON allowances(delegated_signer, status);
      CREATE TABLE IF NOT EXISTS attempts (
        attempt_id TEXT PRIMARY KEY, allowance_id TEXT NOT NULL, url TEXT NOT NULL,
        request_reference TEXT NOT NULL, challenge_hash TEXT NOT NULL, amount_atomic TEXT NOT NULL,
        pay_to TEXT NOT NULL, asset_contract TEXT NOT NULL, state TEXT NOT NULL, decision TEXT NOT NULL,
        reason_code TEXT, safe_detail TEXT, facilitator_status TEXT, tx_hash TEXT UNIQUE,
        receipt_hash TEXT, receipt_json TEXT, response_hash TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE(allowance_id, request_reference),
        FOREIGN KEY(allowance_id) REFERENCES allowances(allowance_id)
      );
      CREATE INDEX IF NOT EXISTS attempts_allowance_created ON attempts(allowance_id, created_at DESC);
    `);
  }

  putAllowance(record: AllowanceRecord): void {
    this.#db.prepare(`
      INSERT INTO allowances VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(allowance_id) DO UPDATE SET
        label=excluded.label, spent_atomic=excluded.spent_atomic,
        revoke_tx_hash=excluded.revoke_tx_hash, status=excluded.status, updated_at=excluded.updated_at
    `).run(
      record.allowanceId, record.label, record.network, record.treasuryContract, record.assetContract,
      record.delegatedSigner, record.maxSpendAtomic, record.spentAtomic, record.windowLedgers,
      JSON.stringify(record.allowedRecipients), record.validUntilLedger, record.contextRuleId,
      record.createTxHash ?? null, record.revokeTxHash ?? null, record.status, record.createdAt, record.updatedAt,
    );
  }

  getAllowance(id: string): AllowanceRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM allowances WHERE allowance_id = ?").get(id);
    return row ? parseAllowance(row) : undefined;
  }

  listAllowances(): AllowanceRecord[] {
    return this.#db.prepare("SELECT * FROM allowances ORDER BY created_at DESC").all().map(parseAllowance);
  }

  putAttempt(record: PaymentAttempt): void {
    this.#db.prepare(`
      INSERT INTO attempts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(attempt_id) DO UPDATE SET
        state=excluded.state, decision=excluded.decision, reason_code=excluded.reason_code,
        safe_detail=excluded.safe_detail, facilitator_status=excluded.facilitator_status,
        tx_hash=excluded.tx_hash, receipt_hash=excluded.receipt_hash, receipt_json=excluded.receipt_json,
        response_hash=excluded.response_hash, updated_at=excluded.updated_at
    `).run(
      record.attemptId, record.allowanceId, record.url, record.requestReference, record.challengeHash,
      record.amountAtomic, record.payTo, record.assetContract, record.state, record.decision,
      record.reasonCode ?? null, record.safeDetail ?? null, record.facilitatorStatus ?? null,
      record.txHash ?? null, record.receiptHash ?? null,
      record.receipt ? JSON.stringify(record.receipt) : null, record.responseHash ?? null,
      record.createdAt, record.updatedAt,
    );
  }

  getAttempt(id: string): PaymentAttempt | undefined {
    const row = this.#db.prepare("SELECT * FROM attempts WHERE attempt_id = ?").get(id);
    return row ? parseAttempt(row) : undefined;
  }

  findAttempt(allowanceId: string, requestReference: string): PaymentAttempt | undefined {
    const row = this.#db.prepare(
      "SELECT * FROM attempts WHERE allowance_id = ? AND request_reference = ?",
    ).get(allowanceId, requestReference);
    return row ? parseAttempt(row) : undefined;
  }

  listAttempts(limit = 100): PaymentAttempt[] {
    return this.#db.prepare("SELECT * FROM attempts ORDER BY created_at DESC LIMIT ?").all(limit).map(parseAttempt);
  }
}
