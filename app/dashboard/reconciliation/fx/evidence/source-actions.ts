'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { sourceReadIntent } from '@/lib/fx/retained-source';
import { verifyOwnedInvoiceSource } from '@/lib/fx/retained-source-store';
const target = '/dashboard/reconciliation/fx/evidence';
export async function checkInvoiceRetainedSource(form: FormData) {
  const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
  if (error || !user) redirect('/login');
  let intent;
  try {
    const keys = [...form.keys()];
    if (keys.length > 32 || keys.filter(k => !k.startsWith('$ACTION_')).sort().join(',') !== 'factId,humanConfirmed,reason,requestId' || [...form.values()].some(v => typeof v !== 'string' || v.length > 1200) || form.get('humanConfirmed') !== 'yes') throw new Error();
    intent = sourceReadIntent({ schema_version: 'invoice-source-read-intent/1', request_id: form.get('requestId'), fact_revision_id: form.get('factId'), reason: form.get('reason') });
  } catch { redirect(target + '?sourceCheck=invalid'); }
  let outcome;
  try { outcome = (await verifyOwnedInvoiceSource(db, user.id, intent)).outcome; }
  catch { redirect(target + '?sourceCheck=error'); }
  revalidatePath(target);
  redirect(target + '?sourceCheck=' + outcome);
}
