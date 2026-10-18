/** Reference previews only. No database connection, approval or financial write. */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { refundSplitReview } from '../lib/records/refund-splits';
import { refundReversalClosure } from '../lib/records/refund-closure';
import { splitRefundFixture, refundClosureFixture, refundFixtureId as id } from '../lib/records/refund-split-fixture';
import { formatPounds, amountToWords } from '../lib/invoices/money';
import { evidenceLedger, type SourceExportRow } from '../lib/records/source-export';
import { evidenceManifest } from '../lib/records/evidence-manifest';
import { getCurrentTaxYearStart } from '../lib/records/tax-periods';

async function main() {
    const directory = resolve(process.argv[2] ?? '/tmp/vibecount-split-refund-demo');
    const f = splitRefundFixture(), split = refundSplitReview(f.owner, f.intent, f.catalog);
    const graph = refundClosureFixture(), closure = refundReversalClosure(graph.owner_id, { kind: 'original', id: id(100) }, graph);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'split-preview.json'), JSON.stringify(split, null, 2) + '\n');
    await writeFile(join(directory, 'reversal-closure-preview.json'), JSON.stringify(closure, null, 2) + '\n');
    // Hypothetical post-review state only; synthetic IDs/hashes are not source evidence.
    const row:SourceExportRow={id:f.refund.id,transaction_date:f.refund.transaction_date,signed_amount_pence:f.refund.signed_amount_pence,currency:'GBP',description:'Synthetic projected split refund',reference:'',classification:'Refund',business_use_bps:0,dedupe_status:'clear',decision_version:1,source_row_id:f.refund.source_row_id,tax_year_start:getCurrentTaxYearStart(new Date(f.refund.transaction_date+'T00:00:00Z')),source_rows:{row_number:2,row_hash:'d'.repeat(64)},active_refund_id:id(800),
        record:split.result.portions.flatMap((p,i)=>p.recognized_pence>0?[{id:id(700+i),bank_transaction_id:f.refund.id,amount:Math.floor(p.recognized_pence/100)+'.'+String(p.recognized_pence%100).padStart(2,'0'),status:'approved',record_type:p.record_type,effect_sign:-1,refund_link_id:id(800+i),category_id:p.category_id,project_id:p.project_id,record_date:f.refund.transaction_date}]:[]),
        refund_portions:split.result.portions.map((p,i)=>({id:id(800+i),original_transaction_id:p.original_id,refund_transaction_id:f.refund.id,amount_pence:p.amount_pence,recognized_pence:p.recognized_pence,record_type:p.record_type,business_use_bps:p.business_use_bps,category_id:p.category_id,request_id:f.intent.request_id,original:{id:p.original_id,import_id:p.original_import_id,source_row_id:p.original_source_row_id,transaction_date:p.original_date},reversals:[]}))};
    const meta={id:f.refund.import_id,file_hash:'c'.repeat(64),parser_version:'synthetic-split-projection/1',account_id:f.refund.account_id,status:'review',created_at:'2026-10-17',coverage_start:f.refund.transaction_date,coverage_end:f.refund.transaction_date,account_label:'Synthetic account',account_mask:'1234'};
    const ledger=evidenceLedger(meta,[row]);if(ledger.expensePence!==-split.result.expense_reduction_pence || ledger.incomePence!==-split.result.income_reduction_pence)throw new Error('Projection demo totals differ.');
    await writeFile(join(directory,'hypothetical-evidence-ledger-v2.csv'),ledger.csv);
    await writeFile(join(directory,'hypothetical-evidence-manifest-v2.json'),JSON.stringify(evidenceManifest(meta,{label:meta.account_label,masked_identifier:meta.account_mask},[row]),null,2)+'\n');
    const money = (p: number) => `${formatPounds(p)} (${amountToWords(p)})`;
    const text = `SYNTHETIC REFERENCE MODEL — no financial action.\nCombined refund cash ${money(split.result.observed_cash_pence)}.\nOriginal portions ${split.result.portions.map(p => money(p.amount_pence)).join(' and ')}.\nRecognised expense reduction ${money(split.result.expense_reduction_pence)}; originals keep their own categories/projects/years and the refund effects use their cash date.\n\nSeparate connected-component example: ${closure.link_ids.length} links across ${closure.original_ids.length} originals and ${closure.refund_ids.length} refund observations. Cash counted once: ${money(closure.observed_refund_cash_pence)}. Expense reductions removed on hypothetical reversal: ${money(closure.expense_reduction_removed_pence)}. No cash moves and no earlier approval is restored.\n\nThese artifacts are previews, not persisted approvals. The hypothetical v2 evidence outputs simulate reviewed effects using synthetic IDs and placeholder hashes; they are not preserved original evidence. The current application still approves one original per refund observation. A complete connected reversal has a separate explicit human review; this demo performs no reversal. Shared posting/projection/report/export changes, full-import review and the split approval UI remain required before enabling actual split approval. No migration or real source, payment, invoice or filing action is performed by this demo.\n`;
    await writeFile(join(directory, 'README.txt'), text); console.log(text + '\nReference artifacts: ' + directory);
}
main().catch(() => { console.error('Synthetic split-refund demonstration failed.'); process.exitCode = 1; });
