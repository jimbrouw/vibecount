type Page<T> = { data: T[] | null; error: unknown };

/** Read to an empty page, even if the server caps results below our requested limit. */
export async function readAllExportRows<T extends { id: string }>(
  fetchPage: (afterId: string | null) => PromiseLike<Page<T>>,
  limits?: { maxRows: number; maxBytes: number },
): Promise<T[]> {
  const all: T[] = [];
  let bytes = 0;
  let cursor: string | null = null;
  while (true) {
    const { data, error } = await fetchPage(cursor);
    if (error || !data) throw new Error("Could not read a complete export.");
    if (data.length === 0) return all;
    if(limits){bytes+=new TextEncoder().encode(JSON.stringify(data)).length;if(all.length+data.length>limits.maxRows||bytes>limits.maxBytes)throw new Error('Complete export exceeds bounded read capacity.');}
    for (const row of data) {
      if (typeof row.id !== "string" || !row.id || (cursor !== null && row.id <= cursor)) {
        throw new Error("Export paging did not advance in ID order.");
      }
      cursor = row.id;
      all.push(row);
    }
  }
}
