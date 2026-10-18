import { createHash } from 'node:crypto';
import { evidenceManifest } from './evidence-manifest';
import { parseFxProvenance } from '../fx/provenance';

/** V2 producer stays frozen; V3 hashes both its source snapshot and FX context. */
export function evidenceManifestV3(owner: string, source: Parameters<typeof evidenceManifest>[0], account: Parameters<typeof evidenceManifest>[1], rows: Parameters<typeof evidenceManifest>[2], rawFx: unknown) {
  const retained = evidenceManifest(source, account, rows);
  const fx = parseFxProvenance(owner, rawFx, rows.map(row => ({ ...row, import_id: source.id })));
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
  const snapshot = { ...retained.snapshot, fx_provenance: fx };
  return { ...retained, schema_version: 'vibecount.evidence-manifest/3',
    scope: 'Current source evidence, decisions and complete retained FX relationship context; not a locked filing pack, tax certification or full backup.',
    hash_definitions: { ...retained.hash_definitions, snapshot_sha256: 'SHA-256 of UTF-8 JSON.stringify(snapshot) as emitted, including retained FX context. Integrity only, not an authenticity signature.',
      source_snapshot_sha256: 'Unchanged V2 source snapshot hash, excluding FX relationships.', fx_provenance_sha256: 'SHA-256 of UTF-8 JSON.stringify(snapshot.fx_provenance) as emitted; lots and events sorted by ID.' },
    source_snapshot_sha256: retained.snapshot_sha256, fx_provenance_sha256: digest(fx), snapshot_sha256: digest(snapshot), snapshot };
}
