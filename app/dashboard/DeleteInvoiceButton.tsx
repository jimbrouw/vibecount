"use client";

import { deleteInvoice } from "@/app/dashboard/invoices/actions";

export default function DeleteInvoiceButton({ invoiceId }: { invoiceId: string }) {
  return (
    <form
      action={deleteInvoice}
      onSubmit={(e) => {
        if (!confirm("Are you sure you want to delete this invoice? This cannot be undone.")) {
          e.preventDefault();
        }
      }}
      data-testid={`dashboard-invoice-delete-form-${invoiceId}`}
      className="inline-flex"
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button
        type="submit"
        data-testid={`dashboard-invoice-delete-button-${invoiceId}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50"
      >
        Delete
      </button>
    </form>
  );
}
