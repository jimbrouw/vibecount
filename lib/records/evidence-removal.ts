import { randomUUID } from 'node:crypto';

export type EvidenceRemovalWorker = {
  rpc(name: string, args: Record<string, string | boolean>): PromiseLike<{data: unknown; error: unknown}>;
  remove(bucket: string, path: string): PromiseLike<{error: unknown}>;
  /** Must verify provider absence; a metadata-only lookup is insufficient. */
  verifyAbsent(bucket: string, path: string): PromiseLike<boolean>;
};

/** Private worker protocol. Not connected to a route or application credentials. */
export async function removeEvidenceObject(worker: EvidenceRemovalWorker, target: {
  owner: string; request: string; bucket: 'source-evidence' | 'document-evidence'; path: string;
}): Promise<'absent' | 'failed' | 'unknown'> {
  const attempt = randomUUID();
  const begun = await worker.rpc('begin_evidence_removal', {
    p_owner: target.owner, p_request: target.request, p_bucket: target.bucket,
    p_path: target.path, p_attempt: attempt,
  });
  if (begun.error || begun.data !== true) throw new Error('Evidence removal was not authorized.');

  let outcome: 'absent' | 'failed' | 'unknown' = 'unknown';
  try {
    const removed = await worker.remove(target.bucket, target.path);
    if (removed.error) outcome = 'failed';
    else if (await worker.verifyAbsent(target.bucket, target.path) === true) outcome = 'absent';
  } catch {
    // A lost response is not proof of absence. Preserve uncertainty durably.
  }
  const recorded = await worker.rpc('record_evidence_removal_outcome', {
    p_owner: target.owner, p_attempt: attempt, p_outcome: outcome,
    p_provider_absent: outcome === 'absent',
  });
  if (recorded.error || recorded.data !== true)
    throw new Error('Removal outcome could not be recorded; the attempt remains unresolved.');
  return outcome;
}
