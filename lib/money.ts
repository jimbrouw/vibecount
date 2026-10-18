/** Canonical decimal values (no currency symbols/grouping) to exact, bounded pence. */
export function decimalToPence(value: string | number): number | null {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(String(value).trim());
  if (!match) return null;
  const magnitude =
    BigInt(match[2]) * BigInt(100) + BigInt((match[3] ?? "").padEnd(2, "0"));
  const signed = match[1] ? -magnitude : magnitude;
  if (
    signed > BigInt(Number.MAX_SAFE_INTEGER) ||
    signed < BigInt(Number.MIN_SAFE_INTEGER)
  )
    return null;
  return Number(signed);
}

export function requirePence(value: string | number): number {
  const amount = decimalToPence(value);
  if (amount === null)
    throw new Error("Invalid or out-of-range monetary value.");
  return amount;
}

export function sumPence(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) {
      throw new Error("Monetary total is out of range.");
    }
    total += value;
  }
  return total;
}

/** Round a business-use share to the nearest penny, ties away from zero. */
export function apportionPence(pence: number, basisPoints: number): number {
  if (
    !Number.isSafeInteger(pence) ||
    !Number.isInteger(basisPoints) ||
    basisPoints < 0 ||
    basisPoints > 10000
  ) {
    throw new Error("Invalid amount or business-use percentage.");
  }
  const share =
    (BigInt(Math.abs(pence)) * BigInt(basisPoints) + BigInt(5000)) /
    BigInt(10000);
  return (pence < 0 ? -1 : 1) * Number(share);
}
