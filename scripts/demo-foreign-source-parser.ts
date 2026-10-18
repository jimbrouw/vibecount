import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseDimensionedSourceCsv } from '../lib/records/source-csv-v2';
import { readSourceCsv, suggestMapping } from '../lib/records/source-csv';

async function main() {
  const fixtures = JSON.parse(await readFile(new URL('../fixtures/synthetic-foreign-sources.json', import.meta.url), 'utf8')) as
    { name: string; currency: string; provider: string; csv: string }[];
  const output = '/tmp/vibecount-foreign-source-parser-demo';
  await mkdir(output, { recursive: true });
  const sources = [];
  for (const fixture of fixtures) {
    const bytes = Buffer.from(fixture.csv, 'utf8');
    const result = parseDimensionedSourceCsv(fixture.csv,
      suggestMapping(readSourceCsv(fixture.csv)[0], fixture.provider), fixture.currency);
    assert.ok(result.rows.every(r => r.signedAmountPence === null));
    await writeFile(join(output, fixture.name + '.csv'), bytes);
    sources.push({ name: fixture.name, source_sha256: createHash('sha256').update(bytes).digest('hex'),
      source_size_bytes: bytes.length, ...result });
  }
  await writeFile(join(output, 'parsed-originals.json'), JSON.stringify({
    synthetic_only: true, scope: 'Internal parser dependency only; not an import, valuation, classification or financial posting.',
    foreign_ingestion_enabled: false, gbp_values_inferred: 0, sources,
  }, null, 2));
  await writeFile(join(output, 'README.md'), '# Synthetic foreign source parser demo\n\n' +
    'Four separate USD/EUR/JPY/KWD statement-shaped fixtures retain original units, dates, signs and logical rows. ' +
    'The EUR fixture uses card-charge signs; repayment is an observation, not recognised income. Identical USD purchases remain separate.\n\n' +
    'Every foreign GBP projection is null. No exchange rate is assumed. Files are synthetic, not certified provider formats. ' +
    'This demo does not register/import data, deduplicate it, value it, classify it, post it or claim tax/reporting readiness. ' +
    'The live app remains GBP-only until the full valuation/coverage/posting/reversal journey is complete.\n');
  process.stdout.write('Synthetic parser-only artifacts: ' + output + '\n');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
