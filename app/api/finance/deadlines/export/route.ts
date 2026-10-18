import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { assertDeadlineProvenance, readDeadlineHistoricalSources, type DeadlineRevision } from '@/lib/finance/deadlines/server';
import { verifyDeadlineSnapshot } from '@/lib/finance/deadlines/snapshot';
export async function GET(request: Request) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Sign in to export deadline history.' }, { status: 401 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'Choose a saved review.' }, { status: 400 });
    const r = await db.from('tax_deadline_revisions').select('*').eq('user_id', user.id).eq('id', id).maybeSingle();
    if (r.error) return NextResponse.json({ error: 'Deadline history unavailable.' }, { status: 500 });
    if (!r.data) return NextResponse.json({ error: 'Review not found.' }, { status: 404 });
    try {
        const row = r.data as DeadlineRevision; assertDeadlineProvenance(row, user.id);
        const catalog = await readDeadlineHistoricalSources(db, user.id, row), verified = verifyDeadlineSnapshot(row, user.id, catalog);
        const audit = await db.from('record_exports').insert({ user_id: user.id, export_type: 'json', record_count: row.result.items.length, tax_year_start: row.tax_year_start, tax_deadline_id: id, completed_at: new Date().toISOString() });
        if (audit.error) throw new Error('Audit failed.');
        return NextResponse.json({ ...verified, id, ordinal: row.ordinal, author: row.author, rationale: row.rationale, created_at: row.created_at }, { headers: { 'Content-Disposition': `attachment; filename="vibecount-draft-deadlines-${id}.json"`, 'Cache-Control': 'private, no-store' } });
    } catch { return NextResponse.json({ error: 'Historical sources, integrity or export audit could not be verified.' }, { status: 500 }); }
}
