import { originalDownload } from '@/lib/records/original-download';
import { readSourceOriginal } from '@/lib/records/source-original-store';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{importId:string}>}){return originalDownload(request,(await params).importId,readSourceOriginal)}
