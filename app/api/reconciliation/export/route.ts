import type {
  RefundExportLink,
  RefundExportReversal,
} from "@/lib/records/refund-export";
import { NextResponse } from "next/server";
import type {
  AssignmentExportRow,
  AssignmentExportReversal,
} from "@/lib/invoices/refund-assignment-export";
import type {
  CreditExportNote,
  CreditExportReversal,
} from "@/lib/invoices/credit-export";
import { createClient } from "@/lib/supabase/server";
import { readAllExportRows } from "@/lib/records/export-pages";
import { readConsistentReconciliation } from "@/lib/records/consistent-reconciliation";
import type {
  TransferExportPair,
  TransferExportReversal,
} from "@/lib/records/transfer-export";
import {
  type ReceiptExportBalance,
  type InvoiceExportBalance,
} from "@/lib/records/reconciliation-export";

import { INVOICE_REPORTING_COLUMNS } from "@/lib/invoices/reporting";
import { INVOICE_FACT_EXPORT_COLUMNS, type InvoiceDocumentExportRow, type InvoiceFactExportRow } from "@/lib/records/reconciliation-currency-export";

import { type DimensionedSettlementExportRow, type ExternalSettlementBalance } from '@/lib/records/reconciliation-dimensioned-export';
import { bankReconciliationExport } from '@/lib/records/reconciliation-bank-export';
import { readBankExport } from '@/lib/records/bank-export-store';
import { FX_EVENT_COLUMNS, FX_LOT_SOURCE_COLUMNS } from '@/lib/fx/settlement-history';

export const runtime = "nodejs";
export async function GET() {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user)
    return NextResponse.json(
      { error: "Sign in to export reconciliation." },
      { status: 401 },
    );
  try {
    const bank = await readBankExport(db, user.id);
    const readStamp = async () => {
      const { data, error: stampError } = await db.rpc(
        "reconciliation_export_stamp",
      );
      if (stampError || typeof data !== "string")
        throw new Error("Could not verify export consistency.");
      return data;
    };
    const [
      events,
      receipts,
      invoices,
      pairs,
      reversals,
      refunds,
      refundReversals,
      credits,
      creditReversals,
      assignments,
      assignmentReversals,
      documentSources,
      lots,
      externalBalances,
    ] = await readConsistentReconciliation(readStamp, () =>
      Promise.all([
        readAllExportRows<DimensionedSettlementExportRow>(async (after) => {
          let q = db
            .from("invoice_settlements")
            .select(
              `${FX_EVENT_COLUMNS},transaction:bank_transactions(id,transaction_date,source_row_id,source_rows(row_number,row_hash),record_imports(file_hash,parser_version))`,
            )
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return {
            data: r.data as unknown as DimensionedSettlementExportRow[] | null,
            error: r.error,
          };
        }),
        readAllExportRows<ReceiptExportBalance>(async (after) => {
          let q = db
            .from("receipt_allocation_balances")
            .select(
              "id,import_id,transaction_date,signed_amount_pence,allocated_pence,unallocated_pence,classification,record_status,active_transfer_id,active_refund_id,refunded_pence,source_row_id,source_rows(row_number,row_hash),record_imports(file_hash)",
            )
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return {
            data: r.data as unknown as ReceiptExportBalance[] | null,
            error: r.error,
          };
        }),
        readAllExportRows<InvoiceExportBalance>(async (after) => {
          let q = db
            .from("invoice_payment_balances")
            .select(
              "id,number,currency,status,invoice_pence,allocated_pence,outstanding_pence,credited_pence,entitlement_pence,refund_due_pence,retained_cash_pence,returned_pence,delivery_status",
            )
            .eq("user_id", user.id)
            .eq("status", "finalised")
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return { data: r.data, error: r.error };
        }),
        readAllExportRows<TransferExportPair>(async (after) => {
          let q = db
            .from("transfer_pairs")
            .select(
              "id,kind,amount_pence,author,rationale,request_id,created_at,outgoing:bank_transactions!transfer_pairs_outgoing_owner_fk(id,source_row_id,source_rows(row_number,row_hash),record_imports(file_hash),financial_accounts(label,masked_identifier)),incoming:bank_transactions!transfer_pairs_incoming_owner_fk(id,source_row_id,source_rows(row_number,row_hash),record_imports(file_hash),financial_accounts(label,masked_identifier))",
            )
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return {
            data: r.data as unknown as TransferExportPair[] | null,
            error: r.error,
          };
        }),
        readAllExportRows<TransferExportReversal>(async (after) => {
          let q = db
            .from("transfer_reversals")
            .select("id,pair_id,author,rationale,request_id,created_at")
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return { data: r.data, error: r.error };
        }),
        readAllExportRows<RefundExportLink>(async (after) => {
          let q = db
            .from("refund_links")
            .select(
              "id,original_transaction_id,refund_transaction_id,amount_pence,recognized_pence,record_type,category_id,business_use_bps,author,rationale,request_id,created_at,original_snapshot,refund_snapshot,original:bank_transactions!refund_links_original_owner_fk(id,source_row_id,source_rows(row_number,row_hash),record_imports(file_hash),financial_accounts(label,masked_identifier)),refund:bank_transactions!refund_links_refund_owner_fk(id,signed_amount_pence,source_row_id,source_rows(row_number,row_hash),record_imports(file_hash),financial_accounts(label,masked_identifier))",
            )
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return {
            data: r.data as unknown as RefundExportLink[] | null,
            error: r.error,
          };
        }),
        readAllExportRows<RefundExportReversal>(async (after) => {
          let q = db
            .from("refund_reversals")
            .select("id,refund_id,author,rationale,request_id,created_at")
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return { data: r.data, error: r.error };
        }),
        readAllExportRows<CreditExportNote>(async (after) => {
          let q = db
            .from("invoice_credit_notes")
            .select(
              "id,invoice_id,number,credit_date,gross_pence,net_pence,vat_pence,tax_status,pdf_sha256,invoice_snapshot,author,rationale,request_id,created_at",
            )
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return { data: r.data as CreditExportNote[] | null, error: r.error };
        }),
        readAllExportRows<CreditExportReversal>(async (after) => {
          let q = db
            .from("invoice_credit_reversals")
            .select("id,credit_id,author,rationale,request_id,created_at")
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return { data: r.data, error: r.error };
        }),
        readAllExportRows<AssignmentExportRow>(async (after) => {
          let q = db
            .from("invoice_refund_assignments")
            .select(
              "id,invoice_id,allocation_id,credit_id,refund_id,amount_pence,invoice_snapshot,credit_snapshot,author,rationale,request_id,created_at",
            )
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          const r = await q;
          return {
            data: r.data as AssignmentExportRow[] | null,
            error: r.error,
          };
        }),
        readAllExportRows<AssignmentExportReversal>(async (after) => {
          let q = db
            .from("invoice_refund_assignment_reversals")
            .select("id,assignment_id,author,rationale,request_id,created_at")
            .eq("user_id", user.id)
            .order("id")
            .limit(500);
          if (after) q = q.gt("id", after);
          return await q;
        }),
        (async () => {
          const documents = await readAllExportRows<InvoiceDocumentExportRow>(async (after) => {
            let q = db.from("invoices").select(`${INVOICE_REPORTING_COLUMNS},number,invoice_date`).eq("user_id", user.id).eq("status", "finalised").order("id").limit(500);
            if (after) q = q.gt("id", after);
            const r = await q;
            return { data: r.data, error: r.error };
          });
          const ids = [...new Set(documents.flatMap(d => d.source_fact_revision_id ? [d.source_fact_revision_id] : []))];
          const facts: InvoiceFactExportRow[] = [];
          for (let start = 0; start < ids.length; start += 100) {
            const batch = ids.slice(start, start + 100);
            facts.push(...await readAllExportRows<InvoiceFactExportRow>(async (after) => {
              let q = db.from("fx_document_fact_revisions").select(INVOICE_FACT_EXPORT_COLUMNS).eq("user_id", user.id).in("id", batch).order("id").limit(500);
              if (after) q = q.gt("id", after);
              const r = await q;
              return { data: r.data, error: r.error };
            }));
          }
          return { documents, facts };
        })(),
        readAllExportRows<{ id: string } & Record<string,unknown>>(async after => { let q=db.from('fx_lot_export_sources').select(FX_LOT_SOURCE_COLUMNS).eq('user_id',user.id).order('id').limit(500);if(after)q=q.gt('id',after);const r=await q;return{data:r.data,error:r.error}; }),
        readAllExportRows<ExternalSettlementBalance>(async after => { let q=db.from('external_invoice_settlement_balances').select('id,user_id,invoice_revision_id,currency,original_total_minor,allocated_original_minor,outstanding_original_minor,allocated_cash_currency,allocated_cash_pence,settlement_state,has_reconciliation_history').eq('user_id',user.id).order('id').limit(500);if(after)q=q.gt('id',after);const r=await q;return{data:r.data,error:r.error}; }),
      ]),
    );
    const result = bankReconciliationExport({
      owner: user.id, ...documentSources, events, fx_lots: lots, external_balances: externalBalances,
      legacy: [[], receipts, invoices, pairs, reversals, refunds, refundReversals, credits, creditReversals, assignments, assignmentReversals],
    }, bank.context);
    await bank.finish();
    const { error: auditError } = await db.from("record_exports").insert({
      user_id: user.id,
      export_type: "csv",
      record_count: result.count,
      attachment_count: 0,
      completed_at: new Date().toISOString(),
    });
    if (auditError) throw new Error("Could not record export.");
    return new NextResponse(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="vibecount-draft-reconciliation.csv"',
        "Cache-Control": "private, no-store",
        "X-VibeCount-Schema": result.schema_version,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Could not generate a complete reconciliation export." },
      { status: 500 },
    );
  }
}
