import { REASON_MESSAGES, type PolicyReason } from "@agentallowance/shared";

export class AgentAllowanceError extends Error {
  readonly code: PolicyReason;
  readonly attemptId?: string;
  readonly safeDetail?: string;

  constructor(code: PolicyReason, options?: { attemptId?: string; detail?: string; cause?: unknown }) {
    super(REASON_MESSAGES[code], { cause: options?.cause });
    this.name = "AgentAllowanceError";
    this.code = code;
    this.attemptId = options?.attemptId;
    this.safeDetail = options?.detail;
  }
}
