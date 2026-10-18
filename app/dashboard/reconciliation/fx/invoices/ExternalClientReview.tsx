'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { createExternalInvoiceClient } from './actions';
function Submit({ enabled }: { enabled: boolean }) { const { pending } = useFormStatus(); return <button data-testid="external-client-submit" disabled={!enabled || pending} className="rounded border p-2">Save reviewed client label</button>; }
export default function ExternalClientReview({ clientId }: { clientId: string }) { return <Review key={clientId} clientId={clientId} />; }
function Review({ clientId }: { clientId: string }) {
  const [name, setName] = useState(''), [confirmed, setConfirmed] = useState(false);
  return <details className="rounded border p-3"><summary>Add a missing client</summary><form data-testid="external-client-form" action={createExternalInvoiceClient} className="space-y-3"><input name="clientId" type="hidden" value={clientId} /><label className="block">Client label<input data-testid="external-client-name" name="name" maxLength={200} required value={name} onChange={e => { setName(e.target.value); setConfirmed(false); }} className="block w-full rounded border p-2" /></label><p data-testid="external-client-readback">New client: {name.trim() || 'choose a label'}. Save creates only a client label; invoice capture needs a separate review. Omit bank details.</p><label className="flex gap-2"><input data-testid="external-client-confirm" name="humanConfirmed" value="yes" type="checkbox" checked={confirmed} disabled={!name.trim()} onChange={e => setConfirmed(e.target.checked)} />I checked this client label.</label><Submit enabled={!!name.trim() && confirmed} /></form></details>;
}
