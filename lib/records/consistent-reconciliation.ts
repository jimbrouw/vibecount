/** Do not emit mixed financial states when a mutation commits between paged reads. */
export async function readConsistentReconciliation<T>(
  readStamp: () => Promise<string>,
  read: () => Promise<T>,
): Promise<T> {
  const before = await readStamp();
  const result = await read();
  if ((await readStamp()) !== before)
    throw new Error("Reconciliation changed during export. Try again.");
  return result;
}

export async function readFinancialStamp(
  read: () => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<string> {
  const result = await read();
  if (result.error || typeof result.data !== "string")
    throw new Error("Could not verify financial snapshot.");
  return result.data;
}
