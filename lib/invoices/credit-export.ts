export type CreditExportNote = {
  id: string;
  invoice_id: string;
  number: string;
  credit_date: string;
  gross_pence: number | string;
  net_pence: number | string | null;
  vat_pence: number | string | null;
  tax_status: string;
  pdf_sha256: string;
  invoice_snapshot: {
    number: string;
    revision_id?: string | null;
    pdf_sha256?: string | null;
  };
  author: string;
  rationale: string;
  request_id: string;
  created_at: string;
};
export type CreditExportReversal = {
  id: string;
  credit_id: string;
  author: string;
  rationale: string;
  request_id: string;
  created_at: string;
};
export const creditExportHeaders = [
  "credit_id",
  "credit_number",
  "credit_net_pence",
  "credit_vat_pence",
  "credit_tax_status",
  "credit_pdf_sha256",
  "original_revision_id",
  "original_pdf_sha256",
  "credited_pence",
  "entitlement_pence",
  "cash_to_reconcile_pence",
  "retained_cash_pence",
  "commercial_credit_effect_pence",
  "credit_accounting_effect_pence",
  "credit_date",
];
export function creditExportRows(
  notes: CreditExportNote[],
  reversals: CreditExportReversal[],
  prefixColumns: number,
) {
  function row(
    note: CreditExportNote,
    event: CreditExportNote | CreditExportReversal,
    reverse: boolean,
  ) {
    if (
      !note.invoice_snapshot?.number ||
      !/^[a-f0-9]{64}$/.test(note.pdf_sha256) ||
      (note.tax_status === "invoice_snapshot" &&
        (note.net_pence === null || note.vat_pence === null))
    )
      throw new Error("Missing credit provenance.");
    const base = [
      "Draft — not submitted to HMRC",
      "credit_event",
      note.invoice_id,
      note.invoice_snapshot.number,
      "",
      event.id,
      reverse ? "credit_reversal" : "credit",
      reverse ? note.id : "",
      String(note.gross_pence),
      "",
      "",
      "",
      "",
      "",
      "",
      event.created_at,
      reverse ? "reversed" : "approved commercial credit; PDF not sent",
      event.author,
      event.rationale,
      event.request_id,
    ];
    while (base.length < prefixColumns) base.push("");
    base.push(
      note.id,
      note.number,
      note.net_pence === null ? "" : String(note.net_pence),
      note.vat_pence === null ? "" : String(note.vat_pence),
      note.tax_status,
      note.pdf_sha256,
      note.invoice_snapshot.revision_id ?? "",
      note.invoice_snapshot.pdf_sha256 ?? "",
      "",
      "",
      "",
      "",
      `${reverse ? "-" : ""}${note.gross_pence}`,
      "0",
      note.credit_date,
    );
    return base;
  }
  return [
    ...notes.map((n) => row(n, n, false)),
    ...reversals.map((r) => {
      const n = notes.find((v) => v.id === r.credit_id);
      if (!n) throw new Error("Missing reversed credit evidence.");
      return row(n, r, true);
    }),
  ];
}
