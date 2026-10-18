import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifyPlanRevision, type PlanRevision } from '@/lib/finance/server';
export async function GET(request: Request) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user) return NextResponse.json({ error: 'Sign in to export a saved cash plan.' }, { status: 401 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: 'Choose a saved cash plan.' }, { status: 400 });
    const r = await db.from('finance_plan_revisions').select('*').eq('user_id', user.id).eq('id', id).maybeSingle();
    if (r.error) return NextResponse.json({ error: 'Saved plan unavailable.' }, { status: 500 });
    if (!r.data) return NextResponse.json({ error: 'Saved plan not found.' }, { status: 404 });
    try {
        const row = r.data as PlanRevision, verified = verifyPlanRevision(row, user.id);
        const audit = await db.from('record_exports').insert({ user_id: user.id, export_type: 'json', record_count: row.input.plan.assets.length, finance_plan_id: id, tax_year_start: row.input.plan.forecast.tax_year_start, completed_at: new Date().toISOString() });
        if (audit.error) throw new Error('Export audit failed.');
        return NextResponse.json({ ...verified, id, ordinal: row.ordinal, author: row.author, rationale: row.rationale, created_at: row.created_at }, { headers: { 'Content-Disposition': `attachment; filename="vibecount-draft-cash-plan-${id}.json"`, 'Cache-Control': 'private, no-store' } });
    } catch { return NextResponse.json({ error: 'Saved plan integrity or export audit could not be verified.' }, { status: 500 }); }
}
