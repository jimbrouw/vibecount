// Synthetic inert projections for export tests and the local demonstration only.
import { readFileSync } from 'node:fs';
import type { CurrencyReconciliationInput, InvoiceDocumentExportRow } from './reconciliation-currency-export';
import type { reconciliationExportTable } from './reconciliation-export';
import { fxDocumentFactsFixture } from '../fx/document-facts-fixture';
const frozen=JSON.parse(readFileSync(new URL('../../fixtures/reconciliation-v2-frozen.json',import.meta.url),'utf8'));
export function currencyExportFixture(): CurrencyReconciliationInput {
 const f=fxDocumentFactsFixture();
 const native:InvoiceDocumentExportRow={id:'invoice',status:'finalised',origin:'native_gbp',currency:'GBP',amount:'1500.00',original_total_minor:null,currency_ruleset_id:null,source_fact_revision_id:null,source_fact_family_id:null,number:'=INV,1500',invoice_date:'2026-02-01'};
 const external:InvoiceDocumentExportRow={...native,id:'external',origin:'preserved_external',currency:'USD',amount:null,original_total_minor:100000,currency_ruleset_id:f.invoice.ruleset_id,source_fact_revision_id:f.invoice.id,source_fact_family_id:f.invoice.family_id,number:'FX-100',invoice_date:'2026-04-05'};
 const fact={...f.invoice,user_id:f.owner,created_at:'2026-10-17T00:00:00Z',author:f.owner,rationale:'Synthetic original review',source_snapshot:{...f.invoice.source_snapshot,object_path:'PRIVATE_OBJECT',raw_text:'PRIVATE_RAW'}};
 const legacy=structuredClone(frozen.args) as Parameters<typeof reconciliationExportTable>;
 legacy[2][0]={...legacy[2][0],currency:'GBP',status:'finalised'};
 return {owner:f.owner,documents:[native,external],facts:[fact],legacy};
}
