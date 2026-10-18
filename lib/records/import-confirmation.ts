export type ReviewedImportRow = { id: string; updated_at: string };

export function readImportConfirmation(form: FormData): ReviewedImportRow[] | null {
  if (form.get("humanConfirmed") !== "yes") return null;
  try {
    const rows: unknown = JSON.parse(String(form.get("reviewedRows") ?? ""));
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) return null;
    const ids = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof row.id !== "string"
        || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)
        || typeof row.updated_at !== "string" || !Number.isFinite(Date.parse(row.updated_at))
        || ids.has(row.id)) return null;
      ids.add(row.id);
    }
    return rows.map(({ id, updated_at }) => ({ id, updated_at }));
  } catch {
    return null;
  }
}
