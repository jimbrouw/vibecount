import Link from 'next/link';
import {redirect} from 'next/navigation';
import {createClient} from '@/lib/supabase/server';
export const metadata={title:'Reminder delivery history — VibeCount'};
const states:Record<string,string>={pending:'Draft — awaiting confirmation',sending:'Send started — outcome needs checking',unknown:'Outcome uncertain — do not resend',failed:'Legacy uncertain outcome — do not resend',skipped:'Discarded or invalidated',sent:'Provider accepted — inbox delivery unconfirmed'};
const deliveryStates:Record<string,string>={accepted:'Provider accepted — inbox delivery unconfirmed',delivered:'Provider reports delivery',delayed:'Provider reports a delivery delay',needs_attention:'Provider reports a delivery problem — review required'};
export default async function ReminderHistory({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const db=await createClient(),{data:{user}}=await db.auth.getUser();if(!user)redirect('/login');
 const params=await searchParams,page=typeof params.page==='string'&&/^[0-9]{1,5}$/.test(params.page)?Number(params.page):0;
 const {data:rows,error}=await db.from('invoice_reminders').select('id,invoice_id,subject,recipient_email,status,provider_delivery_state,provider_message_id,created_at').eq('user_id',user.id).order('created_at',{ascending:false}).order('id',{ascending:false}).range(page*25,page*25+25);
 const reminders=(rows??[]).slice(0,25),hasNext=(rows??[]).length>25;
 const ids=reminders.map(r=>r.id);
 const attempts=ids.length?await db.from('reminder_send_attempts').select('id,reminder_id,created_at').eq('user_id',user.id).in('reminder_id',ids):{data:[],error:null};
 const attemptIds=(attempts.data??[]).map(a=>a.id);
 const outcomes=attemptIds.length?await db.from('reminder_send_outcomes').select('attempt_id,outcome,created_at').eq('user_id',user.id).in('attempt_id',attemptIds):{data:[],error:null};
 // Each page covers 25 attempts; event pagination is per attempt via future detail views.
 const events=attemptIds.length?await db.from('reminder_provider_events').select('event_id,attempt_id,event_type,occurred_at').eq('user_id',user.id).in('attempt_id',attemptIds).order('occurred_at',{ascending:false}).limit(250):{data:[],error:null};
 const failed=error||attempts.error||outcomes.error||events.error;
 return <main className="mx-auto max-w-4xl p-6" data-testid="reminder-history">
  <Link href="/dashboard" data-testid="reminder-history-dashboard">Back to dashboard</Link>
  <h1 className="mt-4 text-2xl font-semibold">Reminder delivery history</h1>
  <p className="mt-2">Provider acceptance and inbox delivery are different. Uncertain attempts cannot be resent. Verified provider evidence can resolve an attempt without sending another message.</p>
  {failed?<p role="alert">Delivery history is unavailable. Refresh before making delivery decisions.</p>:<>
   {!reminders.length?<p className="mt-6">No reminders on this page.</p>:null}
   <ul className="mt-6 space-y-4">{reminders.map(r=>{
    const attempt=attempts.data?.find(a=>a.reminder_id===r.id),outcome=outcomes.data?.find(o=>o.attempt_id===attempt?.id),history=events.data?.filter(e=>e.attempt_id===attempt?.id)??[];
    return <li key={r.id} className="rounded border p-4" data-testid={`reminder-history-${r.id}`}>
     <h2 className="font-semibold">{r.subject}</h2><p>To: {r.recipient_email}</p>
     <p role="status">{deliveryStates[r.provider_delivery_state??'']??states[r.status]??'Status unavailable'}</p>
     {attempt?<p>Attempt started: {attempt.created_at}. Original outcome: {outcome?.outcome??'not recorded'}.</p>:null}
     {r.provider_message_id?<p>Provider reference: {r.provider_message_id}</p>:null}
     {history.length?<ul aria-label="Verified provider evidence">{history.map(e=><li key={e.event_id}>{e.event_type} — {e.occurred_at}</li>)}</ul>:null}
     {r.status==='failed'?<p>This older send has no recoverable attempt tag. Provider investigation is required; absence of evidence is not permission to resend.</p>:null}
    </li>;
   })}</ul>
   {(events.data?.length??0)>=250?<p>Showing the latest 250 provider events for this page. Older event history is preserved.</p>:null}
   <nav aria-label="Delivery history pages" className="mt-6 flex gap-4">
    {page>0?<Link href={`/dashboard/reminders?page=${page-1}`} data-testid="reminders-previous">Previous page</Link>:null}
    {hasNext?<Link href={`/dashboard/reminders?page=${page+1}`} data-testid="reminders-next">Next page</Link>:null}
   </nav>
  </>}
 </main>;
}
