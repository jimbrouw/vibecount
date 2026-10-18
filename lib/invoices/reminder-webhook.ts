import { createHash } from 'node:crypto';
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const events=new Set(['email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed']);
type ObjectValue=Record<string,unknown>;
function object(value:unknown):ObjectValue|null {return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as ObjectValue:null}
export type VerifiedReminderEvent={attempt:string;eventId:string;type:string;occurredAt:string;bodyHash:string;email:{id:string;from:string;to:string[];subject:string;text:string;attempt_id:string}};
export type ReminderWebhookIO={
 verify:(body:string,headers:{id:string;timestamp:string;signature:string})=>unknown;
 knownAttempt:(id:string)=>Promise<boolean>;
 retrieve:(emailId:string)=>Promise<unknown>;
 record:(event:VerifiedReminderEvent)=>Promise<void>;
};
const response=(status:number)=>Response.json({ok:status<300},{status,headers:{'Cache-Control':'no-store'}});
/** Signature verification precedes parsing, provider reads and all durable effects. */
export async function reminderWebhook(request:Request,io:ReminderWebhookIO):Promise<Response>{
 const headers={id:request.headers.get('svix-id')??'',timestamp:request.headers.get('svix-timestamp')??'',signature:request.headers.get('svix-signature')??''};
 if(!headers.id||headers.id.length>200||!headers.timestamp||!headers.signature||headers.signature.length>2048)return response(400);
 let body:string;
 try {
  if(!request.body)return response(400);
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();return response(413)}parts.push(part.value)}}finally{reader.releaseLock()}
  body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));
 }catch{return response(400)}
 let verified:unknown;
 try {verified=io.verify(body,headers)}catch{return response(400)}
 const event=object(verified);
 if(!event||typeof event.type!=='string'||!events.has(event.type))return response(202);
 const data=object(event.data),tags=object(data?.tags),attempt=tags?.vibecount_attempt;
 if(attempt===undefined)return response(202); // Another email feature uses the same provider.
 if(typeof attempt!=='string'||!uuid.test(attempt)||typeof data?.email_id!=='string'||!uuid.test(data.email_id)||typeof event.created_at!=='string'||!Number.isFinite(Date.parse(event.created_at)))return response(400);
 try {
  if(!await io.knownAttempt(attempt))return response(202);
  const email=object(await io.retrieve(data.email_id));
  const emailTags=Array.isArray(email?.tags)?email.tags.map(object).filter(t=>t?.name==='vibecount_attempt'):[];
  // Never match by recipient/subject alone: the provider must return the exact attempt tag.
  if(!email||email.id!==data.email_id||emailTags.length!==1||emailTags[0]?.value!==attempt||typeof email.from!=='string'||!Array.isArray(email.to)||email.to.length!==1||typeof email.to[0]!=='string'||typeof email.subject!=='string'||typeof email.text!=='string')return response(503);
  await io.record({attempt,eventId:headers.id,type:event.type,occurredAt:event.created_at,bodyHash:createHash('sha256').update(body).digest('hex'),email:{id:data.email_id,from:email.from,to:email.to as string[],subject:email.subject,text:email.text,attempt_id:attempt}});
  return response(200);
 }catch{return response(503)} // Provider/database outages are retryable deliveries, never send retries.
}
