import {
  Address,
  scValToNative,
  StrKey,
  xdr,
} from "@stellar/stellar-sdk";
import {
  FacilitatorPolicyManifest,
  OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2,
  type OpenZeppelinSpendingLimitAdapter,
} from "./manifest.js";

export type ExpectedTransfer = {
  token: string;
  from: string;
  to: string;
  amount: bigint;
  contextRuleId: number;
};

export type PolicyEventReason =
  | "EVENT_MISSING_CONTRACT_ID"
  | "EVENT_NOT_TRANSFER"
  | "TRANSFER_EVENT_MISSING"
  | "TRANSFER_EVENT_DUPLICATE"
  | "TRANSFER_EVENT_MISMATCH"
  | "POLICY_EVENT_UNAPPROVED"
  | "POLICY_EVENT_MALFORMED"
  | "POLICY_EVENT_CONTEXT_MISMATCH"
  | "POLICY_EVENT_DUPLICATE"
  | "FACILITATOR_POLICY_MANIFEST_MISMATCH";

export type PolicyEventValidationResult =
  | {
      valid: true;
      transferEventCount: 1;
      approvedPolicyEvents: Array<{ kind: string; contractId: string; eventName: string }>;
    }
  | { valid: false; reason: PolicyEventReason; detail: string };

type ParsedContractEvent = {
  contractId: string;
  eventName: string | null;
  topics: xdr.ScVal[];
  data: xdr.ScVal;
};

function fail(reason: PolicyEventReason, detail: string): PolicyEventValidationResult {
  return { valid: false, reason, detail };
}

function parseContractEvents(
  diagnosticEvents: Array<xdr.DiagnosticEvent | string>,
): PolicyEventValidationResult | ParsedContractEvent[] {
  const parsed: ParsedContractEvent[] = [];

  for (const raw of diagnosticEvents) {
    let diagnostic: xdr.DiagnosticEvent;
    try {
      diagnostic = typeof raw === "string" ? xdr.DiagnosticEvent.fromXDR(raw, "base64") : raw;
    } catch {
      return fail("EVENT_NOT_TRANSFER", "Malformed diagnostic event XDR");
    }

    const event = diagnostic.event();
    if (event.type().name !== "contract") continue;
    if (!diagnostic.inSuccessfulContractCall()) {
      return fail("EVENT_NOT_TRANSFER", "Contract event originated outside a successful call");
    }

    const contractIdBytes = event.contractId();
    if (!contractIdBytes) return fail("EVENT_MISSING_CONTRACT_ID", "Contract event has no contract ID");

    const body = event.body().v0();
    const topics = body.topics();
    const first = topics[0];
    const eventName =
      first?.switch().name === "scvSymbol" ? first.sym().toString() : null;

    parsed.push({
      contractId: StrKey.encodeContract(Buffer.from(contractIdBytes as unknown as Uint8Array)),
      eventName,
      topics,
      data: body.data(),
    });
  }

  return parsed;
}

function parseTransfer(event: ParsedContractEvent): Omit<ExpectedTransfer, "contextRuleId"> | null {
  if (event.eventName !== "transfer" || event.topics.length < 3) return null;
  const from = event.topics[1];
  const to = event.topics[2];
  if (from?.switch().name !== "scvAddress" || to?.switch().name !== "scvAddress") return null;

  const nativeAmount = scValToNative(event.data);
  const amount =
    typeof nativeAmount === "bigint"
      ? nativeAmount
      : typeof nativeAmount === "number" && Number.isSafeInteger(nativeAmount)
        ? BigInt(nativeAmount)
        : null;
  if (amount === null) return null;

  return {
    token: event.contractId,
    from: Address.fromScVal(from).toString(),
    to: Address.fromScVal(to).toString(),
    amount,
  };
}

function mapFields(value: xdr.ScVal): Map<string, xdr.ScVal> | null {
  if (value.switch().name !== "scvMap") return null;
  const fields = new Map<string, xdr.ScVal>();
  for (const entry of value.map() ?? []) {
    if (entry.key().switch().name !== "scvSymbol") return null;
    const key = entry.key().sym().toString();
    if (fields.has(key)) return null;
    fields.set(key, entry.val());
  }
  return fields;
}

function validateSpendingLimitEvent(
  event: ParsedContractEvent,
  expected: ExpectedTransfer,
): PolicyEventValidationResult | null {
  if (event.eventName !== "spending_limit_enforced" || event.topics.length !== 2) {
    return fail("POLICY_EVENT_MALFORMED", "Unexpected OpenZeppelin spending-limit topics");
  }
  const payerTopic = event.topics[1];
  if (
    payerTopic?.switch().name !== "scvAddress" ||
    Address.fromScVal(payerTopic).toString() !== expected.from
  ) {
    return fail("POLICY_EVENT_CONTEXT_MISMATCH", "Policy payer does not match transfer.from");
  }

  const fields = mapFields(event.data);
  const requiredKeys = ["amount", "context", "context_rule_id", "total_spent_in_period"];
  if (!fields || fields.size !== requiredKeys.length || requiredKeys.some((key) => !fields.has(key))) {
    return fail("POLICY_EVENT_MALFORMED", "Policy data fields do not match the pinned schema");
  }

  const amount = fields.get("amount")!;
  const ruleId = fields.get("context_rule_id")!;
  const total = fields.get("total_spent_in_period")!;
  if (
    amount.switch().name !== "scvI128" ||
    ruleId.switch().name !== "scvU32" ||
    total.switch().name !== "scvI128"
  ) {
    return fail("POLICY_EVENT_MALFORMED", "Policy numeric field types are invalid");
  }

  const nativeAmount = scValToNative(amount) as bigint;
  const nativeTotal = scValToNative(total) as bigint;
  if (
    nativeAmount !== expected.amount ||
    ruleId.u32() !== expected.contextRuleId ||
    nativeTotal < nativeAmount
  ) {
    return fail("POLICY_EVENT_CONTEXT_MISMATCH", "Policy amount, total, or rule ID is inconsistent");
  }

  const context = scValToNative(fields.get("context")!) as unknown;
  if (!Array.isArray(context) || context.length !== 2 || context[0] !== "Contract") {
    return fail("POLICY_EVENT_MALFORMED", "Policy context is not a contract context");
  }
  const call = context[1] as { contract?: unknown; fn_name?: unknown; args?: unknown };
  if (
    call.contract !== expected.token ||
    call.fn_name !== "transfer" ||
    !Array.isArray(call.args) ||
    call.args.length !== 3 ||
    call.args[0] !== expected.from ||
    call.args[1] !== expected.to ||
    call.args[2] !== expected.amount
  ) {
    return fail("POLICY_EVENT_CONTEXT_MISMATCH", "Embedded policy context differs from payment transfer");
  }

  return null;
}

function verifyCodeIdentity(options: {
  adapter: OpenZeppelinSpendingLimitAdapter;
  observedWasmHashes?: Readonly<Record<string, string>>;
}): PolicyEventValidationResult | null {
  const expectedHash = options.adapter.expectedWasmHash;
  if (!expectedHash) return null;
  const observed = options.observedWasmHashes?.[options.adapter.contractId];
  if (!observed || observed.toLowerCase() !== expectedHash.toLowerCase()) {
    return fail(
      "FACILITATOR_POLICY_MANIFEST_MISMATCH",
      `Policy code hash mismatch for ${options.adapter.contractId}`,
    );
  }
  return null;
}

export function validatePolicyAwareSimulationEvents(options: {
  diagnosticEvents: Array<xdr.DiagnosticEvent | string>;
  expected: ExpectedTransfer;
  manifest: FacilitatorPolicyManifest;
  observedWasmHashes?: Readonly<Record<string, string>>;
}): PolicyEventValidationResult {
  if (options.manifest.smartAccount && options.manifest.smartAccount !== options.expected.from) {
    return fail("FACILITATOR_POLICY_MANIFEST_MISMATCH", "Manifest smart account differs from payer");
  }
  if (
    options.manifest.expectedRuleId !== undefined &&
    options.manifest.expectedRuleId !== options.expected.contextRuleId
  ) {
    return fail("FACILITATOR_POLICY_MANIFEST_MISMATCH", "Manifest rule differs from signed rule");
  }

  const parsed = parseContractEvents(options.diagnosticEvents);
  if (!Array.isArray(parsed)) return parsed;

  const transferEvents = parsed.filter((event) => event.eventName === "transfer");
  if (transferEvents.length === 0) return fail("TRANSFER_EVENT_MISSING", "No SEP-41 transfer event found");
  if (transferEvents.length !== 1) {
    return fail("TRANSFER_EVENT_DUPLICATE", `Expected one transfer event, received ${transferEvents.length}`);
  }
  const transfer = parseTransfer(transferEvents[0]!);
  if (
    !transfer ||
    transfer.token !== options.expected.token ||
    transfer.from !== options.expected.from ||
    transfer.to !== options.expected.to ||
    transfer.amount !== options.expected.amount
  ) {
    return fail("TRANSFER_EVENT_MISMATCH", "SEP-41 transfer event differs from payment requirements");
  }

  const policyEvents = parsed.filter((event) => event.eventName !== "transfer");
  const approved: Array<{ kind: string; contractId: string; eventName: string }> = [];
  const seen = new Set<string>();

  for (const event of policyEvents) {
    const adapter = options.manifest.adapters.find((candidate) => candidate.contractId === event.contractId);
    if (!adapter) {
      return fail("POLICY_EVENT_UNAPPROVED", `No manifest adapter for ${event.contractId}`);
    }
    const identityError = verifyCodeIdentity({
      adapter,
      observedWasmHashes: options.observedWasmHashes,
    });
    if (identityError) return identityError;

    const eventKey = `${adapter.kind}:${event.contractId}:${event.eventName ?? "<invalid>"}`;
    if (seen.has(eventKey)) return fail("POLICY_EVENT_DUPLICATE", `Duplicate policy event ${eventKey}`);
    seen.add(eventKey);

    if (adapter.kind === OPENZEPPELIN_SPENDING_LIMIT_V_0_7_2) {
      const validationError = validateSpendingLimitEvent(event, options.expected);
      if (validationError) return validationError;
    } else {
      return fail("POLICY_EVENT_UNAPPROVED", `Unsupported policy adapter kind ${String(adapter.kind)}`);
    }
    approved.push({ kind: adapter.kind, contractId: event.contractId, eventName: event.eventName! });
  }

  for (const adapter of options.manifest.adapters) {
    if (adapter.required && !approved.some((event) => event.contractId === adapter.contractId)) {
      return fail("POLICY_EVENT_MALFORMED", `Required policy event missing for ${adapter.contractId}`);
    }
  }

  return { valid: true, transferEventCount: 1, approvedPolicyEvents: approved };
}
