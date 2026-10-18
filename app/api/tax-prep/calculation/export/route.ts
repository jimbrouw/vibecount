import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { verifySavedCalculation, type SavedCalculation } from '@/lib/tax/snapshot';
export async function GET(request: Request) {
    const db = await createClient(), { data: { user }, error } = await db.auth.getUser();
    if (error || !user)
        return NextResponse.json({ error: 'Sign in to export a saved calculation.' }, { status: 401 });
    const id = new URL(request.url).searchParams.get('id');
    if (!id || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))
        return NextResponse.json({ error: 'Choose a saved draft calculation.' }, { status: 400 });
    const row = await db.from('tax_calculations').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
    if (row.error)
        return NextResponse.json({ error: 'Saved calculation unavailable.' }, { status: 500 });
    if (!row.data)
        return NextResponse.json({ error: 'Saved calculation not found.' }, { status: 404 });
    try {
        const rules = await db.from('tax_rulesets').select('id,canonical_json,sha256').eq('id', row.data.ruleset_id).single();
        if (rules.error || !rules.data)
            throw new Error('Rules unavailable');
        const manifest = verifySavedCalculation(row.data as SavedCalculation, rules.data);
        const audit = await db.from('record_exports').insert({ user_id: user.id, export_type: 'json', record_count: row.data.input.records.length, tax_year_start: row.data.tax_year_start, tax_calculation_id: id, completed_at: new Date().toISOString() });
        if (audit.error)
            throw new Error('Export audit unavailable');
        return NextResponse.json(manifest, { headers: { 'Content-Disposition': `attachment; filename="vibecount-draft-calculation-${id}.json"`, 'Cache-Control': 'private, no-store' } });
    }
    catch {
        return NextResponse.json({ error: 'Saved calculation integrity or export audit could not be verified.' }, { status: 500 });
    }
}
