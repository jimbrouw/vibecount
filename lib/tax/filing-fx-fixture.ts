import { packFixture } from './filing-pack-fixture';
import { prepareCalculation } from './snapshot';
import { fxProvenanceFixture } from '../fx/provenance-fixture';
import { parseFxProvenance } from '../fx/provenance';
import { syntheticCoverage, syntheticExternal } from '../invoices/currency-coverage-fixture';
import type { FilingPackInput } from './filing-pack';
export function filingFxFixture(): Extract<FilingPackInput,{schema_version:'filing-pack-input/3'}> {
  const old=packFixture(),f=fxProvenanceFixture(),invoice={...syntheticExternal('KWD','10001',f.lot.invoice_id),source_fact_revision_id:f.lot.invoice_fact_revision_id,source_fact_family_id:f.lot.invoice_fact.family_id,invoice_date:f.lot.invoice_snapshot.invoice_date};
  const coverage=syntheticCoverage(f.owner,[invoice]),p=prepareCalculation({...old.calculation.input,owner_id:f.owner,schema_version:'tax-calculation-input/2',invoice_coverage:coverage});
  return {...old,owner_id:f.owner,schema_version:'filing-pack-input/3',invoice_coverage:coverage,observations:f.sources,receipt_balances:[{id:f.sources[0].id,transaction_date:f.sources[0].transaction_date,signed_amount_pence:2501,allocated_pence:2500,unallocated_pence:1}],
    calculation:{...old.calculation,input:p.input,result:p.result,input_canonical_json:p.inputJson,result_canonical_json:p.resultJson,input_sha256:p.inputHash,result_sha256:p.resultHash},
    fx_provenance:parseFxProvenance(f.owner,f.raw,f.sources)};
}
