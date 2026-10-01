import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PaymentRequirements, SettlementReceipt } from "@agentallowance/shared";

export type ChallengeRecord = {
  id: string;
  requirements: PaymentRequirements;
  expiresAt: number;
  payloadHash?: string;
  receipt?: SettlementReceipt;
};

export type ChallengeClaim =
  | { status: "acquired" }
  | { status: "pending" }
  | { status: "conflict" }
  | { status: "settled"; receipt: SettlementReceipt };

export class DemoPaymentStore {
  readonly #db: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.#db = new DatabaseSync(filename);
    this.#db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY,
        requirements_json TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        payload_hash TEXT,
        receipt_json TEXT
      );
    `);
  }

  create(record: ChallengeRecord): void {
    this.#db.prepare(
      "INSERT INTO challenges(id, requirements_json, expires_at) VALUES (?, ?, ?)",
    ).run(record.id, JSON.stringify(record.requirements), record.expiresAt);
  }

  get(id: string): ChallengeRecord | undefined {
    const row = this.#db.prepare("SELECT * FROM challenges WHERE id = ?").get(id);
    if (!row) return undefined;
    return {
      id: String(row.id),
      requirements: JSON.parse(String(row.requirements_json)) as PaymentRequirements,
      expiresAt: Number(row.expires_at),
      payloadHash: row.payload_hash ? String(row.payload_hash) : undefined,
      receipt: row.receipt_json ? JSON.parse(String(row.receipt_json)) as SettlementReceipt : undefined,
    };
  }

  claim(id: string, payloadHash: string): ChallengeClaim {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const challenge = this.get(id);
      if (!challenge) {
        this.#db.exec("ROLLBACK");
        return { status: "conflict" };
      }
      if (challenge.receipt) {
        this.#db.exec("COMMIT");
        return challenge.payloadHash === payloadHash
          ? { status: "settled", receipt: challenge.receipt }
          : { status: "conflict" };
      }
      if (challenge.payloadHash) {
        this.#db.exec("COMMIT");
        return { status: challenge.payloadHash === payloadHash ? "pending" : "conflict" };
      }
      const result = this.#db.prepare(
        "UPDATE challenges SET payload_hash = ? WHERE id = ? AND payload_hash IS NULL AND receipt_json IS NULL",
      ).run(payloadHash, id);
      this.#db.exec("COMMIT");
      return result.changes === 1 ? { status: "acquired" } : { status: "conflict" };
    } catch (error) {
      this.#db.exec("ROLLBACK");
      throw error;
    }
  }

  release(id: string, payloadHash: string): void {
    this.#db.prepare(
      "UPDATE challenges SET payload_hash = NULL WHERE id = ? AND payload_hash = ? AND receipt_json IS NULL",
    ).run(id, payloadHash);
  }

  settle(id: string, payloadHash: string, receipt: SettlementReceipt): void {
    this.#db.prepare(
      "UPDATE challenges SET receipt_json = ? WHERE id = ? AND payload_hash = ? AND receipt_json IS NULL",
    ).run(JSON.stringify(receipt), id, payloadHash);
  }
}
