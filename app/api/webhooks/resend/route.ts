import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { reminderWebhook } from '@/lib/invoices/reminder-webhook';
export const runtime='nodejs';
export async function POST(request:Request){
 const secret=process.env.RESEND_WEBHOOK_SECRET,key=process.env.RESEND_API_KEY,db=createAdminClient();
 if(!secret||!key||!db)return Response.json({ok:false},{status:503,headers:{'Cache-Control':'no-store'}});
 const resend=new Resend(key);
 return reminderWebhook(request,{
  verify:(payload,headers)=>resend.webhooks.verify({payload,headers,webhookSecret:secret}),
  async knownAttempt(id){const {data,error}=await db.from('reminder_send_attempts').select('id').eq('id',id).maybeSingle();if(error)throw new Error('Attempt lookup unavailable.');return Boolean(data)},
  async retrieve(id){const {data,error}=await resend.emails.get(id);if(error||!data)throw new Error('Provider evidence unavailable.');return data},
  async record(event){const {error}=await db.rpc('record_reminder_provider_event',{p_attempt:event.attempt,p_event_id:event.eventId,p_event_type:event.type,p_occurred_at:event.occurredAt,p_body_sha256:event.bodyHash,p_email:event.email});if(error)throw new Error('Evidence persistence unavailable.')},
 });
}
