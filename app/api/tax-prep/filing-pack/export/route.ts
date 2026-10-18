import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyFilingPack, type SavedFilingPack } from '@/lib/tax/filing-pack';
export async function GET(request: Request) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user)
        return NextResponse.json({ error: 'Sign in to export a saved draft pack.' }, { status: 401 });
    const params = new URL(request.url).searchParams, id = params.get('id'), name = params.get('artifact');
    if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
        return NextResponse.json({ error: 'Choose a saved draft pack.' }, { status: 400 });
    const row = await db.from('filing_packs').select('*').eq('user_id', user.id).eq('id', id).maybeSingle();
    if (row.error)
        return NextResponse.json({ error: 'Pack unavailable.' }, { status: 500 });
    if (!row.data)
        return NextResponse.json({ error: 'Pack not found.' }, { status: 404 });
    try {
        const bundle = verifyFilingPack(row.data as SavedFilingPack), artifact = name ? bundle.artifacts.find(a => a.name === name) : null;
        if (name && !artifact)
            return NextResponse.json({ error: 'Choose an artifact in this pack.' }, { status: 404 });
        const body = artifact ? artifact.body : JSON.stringify({ schema_version: bundle.schema_version, request_id: row.data.request_id, created_at: row.data.created_at, author: row.data.author, reason: row.data.reason, document_status: bundle.document_status, tax_year_start: bundle.tax_year_start, input_sha256: bundle.input_sha256, bundle_sha256: row.data.bundle_sha256, mapping_version: bundle.mapping_version, mapping_sha256: bundle.mapping_sha256, review_status: bundle.review_status, completeness_attested: bundle.completeness_attested, artifacts: bundle.artifacts.map(({ name, content_type, sha256, size_bytes }) => ({ name, content_type, sha256, size_bytes })) }, null, 2);
        if (Buffer.byteLength(body) > 4000000)
            return NextResponse.json({ error: 'Artifact requires larger-file delivery; no partial output was produced.' }, { status: 413 });
        const audit = await db.from('record_exports').insert({ user_id: user.id, export_type: artifact?.name.endsWith('.csv') ? 'csv' : 'accountant_pack', filing_pack_id: id, tax_calculation_id: row.data.calculation_id, tax_year_start: row.data.tax_year_start, record_count: row.data.input.calculation.input.records.length, attachment_count: row.data.input.documents.length, completed_at: new Date().toISOString() });
        if (audit.error)
            throw new Error('Export audit unavailable');
        return new NextResponse(body, { headers: { 'Content-Type': artifact?.content_type ?? 'application/json', 'Content-Disposition': `${artifact?.name === 'worksheet.html' ? 'inline' : 'attachment'}; filename="vibecount-${id}-${artifact?.name ?? 'manifest.json'}"`, 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' } });
    }
    catch {
        return NextResponse.json({ error: 'Saved pack integrity or export audit could not be verified.' }, { status: 500 });
    }
}
