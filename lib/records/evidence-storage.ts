/** Supabase separates HTTP status from service code. Only a missing object permits regeneration. */
export function isMissingEvidenceObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  const status = Number(e.status),
    code = String(e.statusCode ?? e.code ?? "");
  if (
    status !== 400 &&
    status !== 404 &&
    !(e.status === undefined && code === "404")
  )
    return false;
  return (
    [
      "404",
      "NoSuchKey",
      "ObjectNotFound",
      "object_not_found",
      "not_found",
    ].includes(code) ||
    (status === 404 && code === "")
  );
}
