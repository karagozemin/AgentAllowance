export type OwnedPendingOperation = {
  owner: string;
  kind: string;
  expiresAt: number;
};

export class PendingOwnerOperations<T extends OwnedPendingOperation> {
  readonly #operations = new Map<string, T>();

  put(operationId: string, operation: T): void {
    if (this.#operations.has(operationId)) throw new Error("Pending operation ID already exists");
    this.#operations.set(operationId, operation);
  }

  take(operationId: string, kind: T["kind"], owner: string, now = Date.now()): T {
    const pending = this.#operations.get(operationId);
    this.#operations.delete(operationId);
    if (!pending || pending.owner !== owner || pending.kind !== kind || pending.expiresAt < now) {
      throw new Error("Prepared wallet authorization is missing, expired, or belongs to another wallet");
    }
    return pending;
  }
}
