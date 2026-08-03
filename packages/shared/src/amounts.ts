export function parseAtomicAmount(value: string): bigint {
  if (!/^\d+$/.test(value)) throw new Error("Atomic amount must be an unsigned integer string");
  const parsed = BigInt(value);
  if (parsed <= 0n) throw new Error("Atomic amount must be positive");
  return parsed;
}

export function decimalToAtomic(value: string, decimals = 7): bigint {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error("Amount must be a positive decimal string");
  const [whole = "0", fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places`);
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (atomic <= 0n) throw new Error("Amount must be positive");
  return atomic;
}

export function atomicToDecimal(value: string | bigint, decimals = 7): string {
  const amount = typeof value === "bigint" ? value : BigInt(value);
  const divisor = 10n ** BigInt(decimals);
  const fraction = (amount % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${amount / divisor}.${fraction}` : (amount / divisor).toString();
}
