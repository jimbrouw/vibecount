import { createClient } from '@/lib/supabase/server';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; sandbox"};
const error=(status:number,message:string)=>Response.json({error:message},{status,headers});
export async function originalDownload(request:Request,documentId:string,readOriginal:(owner:string,id:string)=>Promise<{bytes:Buffer;mediaType:string;filename:string}>){
 const db=await createClient(),auth=await db.auth.getUser();if(auth.error||!auth.data.user)return error(401,'Sign in to download your original evidence.');
 if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(documentId))return error(400,'Choose a preserved evidence.');
 if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('content-type')?.split(';')[0]!=='application/x-www-form-urlencoded')return error(403,'Request the download from your evidence review page.');
 try{
  if(!request.body)return error(400,'Invalid download confirmation.');
  const reader=request.body.getReader();let body='';let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>128){await reader.cancel();return error(400,'Invalid download confirmation.');}body+=new TextDecoder().decode(part.value);}}finally{reader.releaseLock();}
  const form=new URLSearchParams(body);if([...form.keys()].length!==1||form.get('humanConfirmed')!=='yes')return error(400,'Confirm the private original download.');
  const original=await readOriginal(auth.data.user.id,documentId);
  const response=new Response(new Uint8Array(original.bytes),{headers:{...headers,'Content-Type':original.mediaType,'Content-Disposition':`attachment; filename="${original.filename}"`,'Content-Length':String(original.bytes.length)}});original.bytes.fill(0);return response;
 }catch{return error(404,'The original could not be verified or access recorded. No document was returned. Retry from Imports or review evidence recovery.');}
}
