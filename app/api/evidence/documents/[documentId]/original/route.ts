import { originalDownload } from '@/lib/records/original-download';
import { readDocumentOriginal } from '@/lib/records/document-original-store';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{documentId:string}>}){return originalDownload(request,(await params).documentId,readDocumentOriginal)}
