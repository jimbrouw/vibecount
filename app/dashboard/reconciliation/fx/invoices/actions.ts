'use server';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { externalInvoiceIntent } from '@/lib/invoices/external';
import { saveExternalInvoice } from '@/lib/invoices/external-store';
import { fxEvidenceId } from '@/lib/fx/document-facts';
import { redactBankDetailsForPrompt } from '@/lib/ai/redaction';
const target = '/dashboard/reconciliation/fx/invoices';
export async function captureExternalInvoice(form: FormData) {
  const db = await createClient(), { data: { user }, error } = await db.auth.getUser(); if (error || !user) redirect('/login');
  let intent;
  try {
    const keys = [...form.keys()];
    if (keys.length > 32 || keys.filter(k => !k.startsWith('$ACTION_')).sort().join(',') !== 'humanConfirmed,intent' || [...form.values()].some(v => typeof v !== 'string' || v.length > 8000) || form.get('humanConfirmed') !== 'yes') throw new Error();
    intent = externalInvoiceIntent(JSON.parse(String(form.get('intent'))));
  } catch { redirect(target + '?error=review'); }
  try { await saveExternalInvoice(db, user.id, intent); } catch { redirect(target + '?error=save'); }
  revalidatePath('/dashboard', 'layout');
  redirect(target + '?result=saved');
}
export async function createExternalInvoiceClient(form: FormData) {
  const db = await createClient(), { data: { user }, error } = await db.auth.getUser(); if (error || !user) redirect('/login');
  try {
    const keys = [...form.keys()];
    if (keys.length > 32 || keys.filter(k => !k.startsWith('$ACTION_')).sort().join(',') !== 'clientId,humanConfirmed,name' || [...form.values()].some(v => typeof v !== 'string' || v.length > 200) || form.get('humanConfirmed') !== 'yes') throw new Error();
    const id = fxEvidenceId(form.get('clientId')), name = String(form.get('name')).trim();
    if (!name || name.length > 200 || redactBankDetailsForPrompt(name) !== name) throw new Error();
    const prior = await db.from('clients').select('id,name').eq('user_id', user.id).eq('id', id).maybeSingle();
    if (prior.error || prior.data && prior.data.name !== name) throw new Error();
    if (!prior.data) { const r = await db.from('clients').insert({ id, user_id: user.id, name }); if (r.error) throw new Error(); }
  } catch { redirect(target + '?error=client'); }
  revalidatePath(target); redirect(target + '?client=saved');
}
