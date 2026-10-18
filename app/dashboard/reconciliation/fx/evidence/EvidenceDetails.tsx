import type { FxConversionDocumentData, FxEvidenceCatalog, FxInvoiceDocumentData } from '@/lib/fx/document-facts';
import { fxAmountReadback, fxRateReadback } from '@/lib/fx/readback';
type Source=FxEvidenceCatalog['documents'][number]['source'];
type Receipt=Pick<FxEvidenceCatalog['receipts'][number],'id'|'import_id'|'source_row_id'|'transaction_date'|'signed_amount_pence'|'decision_version'|'classification'|'dedupe_status'>;
type Parent={id:string;family_id:string;ordinal:number;document_id:string;data:FxInvoiceDocumentData};
export default function EvidenceDetails({source,data,parent,receipt}:{source:Source;data:FxInvoiceDocumentData|FxConversionDocumentData;parent?:Parent|null;receipt?:Receipt|null}){
    const registration=source.registration;
    return <div className="space-y-2 break-words">
        <p>Document {source.document.id} · {source.document.media_type} · {source.document.size_bytes} bytes · {source.available?'Object recorded as available':'Object unavailable in this snapshot'}.</p>
        <p className="break-all">Original SHA-256: {source.document.file_sha256}</p>
        <p>Selected registration: {registration.purpose} · tax year {registration.tax_year_start}/{String(registration.tax_year_start+1).slice(-2)} · item {registration.item_id} · position {registration.ordinal}.</p>
        <a data-testid={`fx-evidence-manifest-${registration.item_id}`} className="underline" href={`/api/evidence/${registration.batch_id}/manifest`}>Review this registration’s evidence manifest</a>
        {'currency' in data?<p>Invoice {data.invoice_reference} · invoice date {data.invoice_date} · original total {fxAmountReadback(data.original_total_minor,data.currency)}.</p>:<>
            {parent&&<p>Invoice evidence revision {parent.id} · family {parent.family_id} · revision {parent.ordinal} · document {parent.document_id} · invoice {parent.data.invoice_reference}, dated {parent.data.invoice_date}, original total {fxAmountReadback(parent.data.original_total_minor,parent.data.currency)}.</p>}
            {receipt&&<><p>Receipt {receipt.id} · source row {receipt.source_row_id} · version {receipt.decision_version} · observed on {receipt.transaction_date}: {fxAmountReadback(receipt.signed_amount_pence,'GBP')} · classification {receipt.classification}, duplicate status {receipt.dedupe_status}.</p>
                <a data-testid={`fx-evidence-receipt-source-${receipt.id}`} className="underline" href={`/dashboard/imports?import=${receipt.import_id}&transaction=${receipt.id}#transaction-${receipt.id}`}>Review this receipt’s source decision</a></>}
            <p>Evidence covers {fxAmountReadback(data.invoice_portion_minor,data.rate.source_currency)} of the invoice and {fxAmountReadback(data.gbp_cash_portion_pence,'GBP')} of the cash.</p>
            <p>Rate: {fxRateReadback(data.rate)}. Conversion date {data.conversion_date}; evidence date {data.evidence_date}. No fees or gross-up included.</p>
            <p>Exact conversion agrees with the evidenced GBP portion, rounded to the nearest penny; exact halves round away from zero.</p>
        </>}
    </div>;
}
