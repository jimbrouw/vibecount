import { FX_CURRENCY_RULESET, rateFromDecimal } from './currency';
import { fxFixtureId as id } from './fixture';
import type { FxDocumentFactIntent } from './document-facts';
export function fxDocumentFactsFixture() {
    const owner=id(1), source={document:{id:id(10),file_sha256:'b'.repeat(64),media_type:'application/pdf',size_bytes:100},available:true,invoice_scope:true,registration:{item_id:id(11),batch_id:id(12),ordinal:0,purpose:'invoice',tax_year_start:2025}};
    const receipt={id:id(20),user_id:owner,import_id:id(21),source_row_id:id(22),transaction_date:'2026-04-06',signed_amount_pence:79000,currency:'GBP',decision_version:0,classification:'Unknown',dedupe_status:'clear',active_transfer_id:null,active_refund_id:null,import_status:'review'};
    const catalog={schema_version:'fx-evidence-catalog/1',owner_id:owner,ruleset_id:FX_CURRENCY_RULESET,stamp:'a'.repeat(32),counts:{documents:1,receipts:1,facts:0},documents:[{id:id(10),source}],receipts:[receipt],facts:[] as Record<string,unknown>[],financial_action:'evidence_preparation_only'};
    const intent:FxDocumentFactIntent={schema_version:'fx-document-fact-intent/1',ruleset_id:FX_CURRENCY_RULESET,family_id:id(30),expected_ordinal:0,kind:'invoice',state:'verified',document_id:id(10),invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:{currency:'USD',original_total_minor:100000,invoice_date:'2026-04-05',invoice_reference:'FX-100'},human_read_original:true,expected_stamp:catalog.stamp,rationale:'Synthetic human source review',request_id:id(40)};
    const invoice={id:id(50),family_id:id(30),kind:'invoice',ordinal:1,state:'verified',ruleset_id:FX_CURRENCY_RULESET,document_id:id(10),invoice_evidence_revision_id:null,transaction_id:null,transaction_version:null,data:structuredClone(intent.data),source_snapshot:{document_source:structuredClone(source)},human_read_original:true,source_current:true,usable:true};
    const conversion:FxDocumentFactIntent={...intent,family_id:id(60),kind:'conversion',invoice_evidence_revision_id:invoice.id,transaction_id:receipt.id,transaction_version:0,data:{rate:rateFromDecimal('USD','GBP','0.79'),conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:100000,gbp_cash_portion_pence:79000,fee_mode:'none'},request_id:id(70)};
    return {owner,source,receipt,catalog,intent,invoice,conversion};
}
