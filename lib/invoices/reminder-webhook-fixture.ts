import {createHmac} from 'node:crypto';
import {Resend} from 'resend';
import type {ReminderWebhookIO} from './reminder-webhook';
const secret='whsec_'+Buffer.from('synthetic-webhook-key-for-tests-only').toString('base64');
const sdk=new Resend('synthetic-not-used-for-network');
export function signedReminderRequest(event:unknown,options:{tampered?:boolean;old?:boolean;huge?:boolean}={}){
 const id='msg_synthetic',timestamp=String(Math.floor(Date.now()/1000)-(options.old?3600:0));
 const payload=options.huge?'x'.repeat(65537):JSON.stringify(event);
 const signature=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.${payload}`).digest('base64');
 return new Request('https://example.invalid/api/webhooks/resend',{method:'POST',headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':'v1,'+signature},body:payload+(options.tampered?' ':'' )});
}
export const verifyReminderSignature:ReminderWebhookIO['verify']=(payload,headers)=>sdk.webhooks.verify({payload,headers,webhookSecret:secret});
