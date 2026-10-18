/** No transport retry: an ambiguous result must be reconciled before another send. */
export type ReminderClaim = {claimed:false;status:string} | {
  claimed:true;attempt_id:string;provider_key:string;
  payload:{from:string;to:string;subject:string;text:string};
};
export async function deliverClaimedReminder(claim:ReminderClaim, io:{
  send:(payload:Extract<ReminderClaim,{claimed:true}>['payload'],key:string,attemptId:string)=>Promise<{id?:string|null}>;
  record:(attempt:string,outcome:'accepted'|'unknown',providerId:string|null)=>Promise<void>;
}):Promise<'accepted'|'unknown'|'already_processed'> {
  if(!claim.claimed)return 'already_processed';
  let id:string|null=null;
  try {
    const p=claim.payload;
    // Whitelist provider fields; the persisted snapshot also holds balance provenance.
    const result=await io.send({from:p.from,to:p.to,subject:p.subject,text:p.text},claim.provider_key,claim.attempt_id);
    if(typeof result.id==='string'&&result.id.trim())id=result.id;
  } catch { /* A timeout/throw is not evidence that the provider rejected the message. */ }
  try {await io.record(claim.attempt_id,id?'accepted':'unknown',id)}
  catch {return 'unknown'} // Durable claim remains visible even if outcome storage failed.
  return id?'accepted':'unknown';
}
