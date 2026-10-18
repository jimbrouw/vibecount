import { fxDocumentFactsFixture } from './document-facts-fixture';
import { fxFixtureId as id } from './fixture';
import { parseFxSettlementCatalog } from './settlement-catalog';
import { rateFromDecimal } from './currency';
/** Safe synthetic canonical/evidence metadata only. Never a financial authority. */
export function fxAuthoritativeReviewFixture(active=false){
 const f=fxDocumentFactsFixture(),rate=rateFromDecimal('KWD','GBP','2.5');
 Object.assign(f.receipt,{signed_amount_pence:2501,classification:'Business',decision_version:1});
 f.invoice.data={currency:'KWD',original_total_minor:10001,invoice_date:'2026-04-05',invoice_reference:'SYNTHETIC-1'};
 const conversion={...structuredClone(f.invoice),id:id(80),family_id:id(60),kind:'conversion',invoice_evidence_revision_id:f.invoice.id,transaction_id:f.receipt.id,transaction_version:1,
  data:{rate,conversion_date:'2026-04-06',evidence_date:'2026-04-07',invoice_portion_minor:10001,gbp_cash_portion_pence:2500,fee_mode:'none'},source_snapshot:{document_source:structuredClone(f.source),invoice_evidence:{id:f.invoice.id,family_id:f.invoice.family_id,ordinal:1,data:structuredClone(f.invoice.data),document_id:f.invoice.document_id},receipt:structuredClone(f.receipt)}};
 f.catalog.facts=[f.invoice,conversion];f.catalog.counts.facts=2;
 const raw={schema_version:'fx-settlement-catalog/2',owner_id:f.owner,ruleset_id:'vibecount-currencies/1',financial_stamp:'a'.repeat(32),scope:'external_invoice_gbp_receipt_no_fees',counts:{invoices:1,receipts:1,lots:active?1:0},
  invoices:[{id:id(100),user_id:f.owner,revision_id:id(101),source_fact_revision_id:f.invoice.id,status:'finalised',invoice_date:'2026-04-05',currency:'KWD',invoice_minor:10001,allocated_minor:active?5000:0,allocated_cash_pence:active?1250:0}],
  receipts:[{id:f.receipt.id,user_id:f.owner,import_id:f.receipt.import_id,source_row_id:f.receipt.source_row_id,transaction_date:f.receipt.transaction_date,currency:'GBP',signed_minor:2501,allocated_minor:active?1250:0,active_refund_count:0,decision_version:1,classification:'Business',business_use_bps:10000,dedupe_status:'clear',active_transfer_id:null,active_refund_id:null,import_status:'review',recognized_record_id:id(23),record_transaction_id:f.receipt.id,record_type:'income',record_status:'approved',effect_sign:1,recognized_gbp_pence:2501}],
  lots:active?[{id:id(70),user_id:f.owner,invoice_id:id(100),invoice_revision_id:id(101),invoice_fact_revision_id:f.invoice.id,invoice_document_id:f.invoice.document_id,invoice_document_sha256:f.source.document.file_sha256,conversion_document_id:conversion.document_id,conversion_document_sha256:f.source.document.file_sha256,conversion_family_id:conversion.family_id,conversion_fact_revision_id:conversion.id,receipt_id:f.receipt.id,receipt_version:1,ruleset_id:'vibecount-currencies/1',invoice_currency:'KWD',cash_currency:'GBP',invoice_limit_minor:10001,cash_limit_minor:2500,rate,conversion_date:'2026-04-06',evidence_date:'2026-04-07',version:1,active_count:1,prior_invoice_minor:5000,prior_cash_minor:1250}]:[],evidence:f.catalog,valuations:[],financial_action:'preview_only'};
 return parseFxSettlementCatalog(f.owner,raw);
}
