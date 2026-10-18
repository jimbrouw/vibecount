import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { currencyExportFixture } from '../lib/records/reconciliation-currency-fixture';
import { currencyReconciliationExport } from '../lib/records/reconciliation-currency-export';
async function main() {
  const directory='/tmp/vibecount-currency-reconciliation-demo',input=currencyExportFixture(),result=currencyReconciliationExport(input);
  await mkdir(directory,{recursive:true});
  await writeFile(directory+'/reconciliation.csv',result.csv);
  await writeFile(directory+'/manifest.json',JSON.stringify({schema_version:result.schema_version,sha256:createHash('sha256').update(result.csv).digest('hex'),rows:result.count,synthetic:true,external_canonical_rows_enabled:false,financial_writes:0,scope:'Inert model demonstration. Original invoice values are not cash, settlements or accounting postings. Source metadata and human attestations are synthetic; no retained original was read.'},null,2)+'\n');
  await writeFile(directory+'/README.md','# Synthetic currency reconciliation export\n\nNative GBP 1,500 and preserved USD 1,000 retain distinct original units. The two historical native allocation/reversal events remain GBP; document rows are non-additive source values. External settlement/cash/valuation fields are unavailable and all legacy pence cells are blank. This is an inert local model demonstration, not an external invoice capture, database approval, readable-original proof or hosted acceptance.\n');
  console.log(JSON.stringify({directory,schema:result.schema_version,rows:result.count,financial_writes:0}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
