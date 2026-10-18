import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { TEST_SCHEMA_BOOTSTRAP } from './test-schema.ts';
test('category integrity upgrades without rewriting legacy links and protects every mutable legacy entry path', async (t) => {
    const db = new PGlite({ extensions: { pgcrypto } });
    t.after(() => db.close());
    await db.exec(TEST_SCHEMA_BOOTSTRAP);
    const dir = new URL('../../supabase/migrations/', import.meta.url), migration = '20261018010000_record_category_integrity.sql';
    for (const file of (await readdir(dir)).filter(n => n.endsWith('.sql') && n < migration).sort())
        await db.exec(await readFile(new URL(file, dir), 'utf8'));
    const owner = randomUUID(), other = randomUUID();
    await db.query('insert into auth.users values ($1),($2)', [owner, other]);
    const categories = [];
    for (const [user, type] of [[owner, 'expense'], [other, 'expense'], [owner, 'income']])
        categories.push((await db.query<{
            id: string;
        }>("insert into record_categories(user_id,name,record_type) values ($1,'Synthetic category',$2) returning id", [user, type])).rows[0].id);
    const legacy = (await db.query<{
        id: string;
    }>("insert into financial_records(user_id,record_type,record_date,amount,description,source_type,status,category_id) values ($1,'expense','2025-08-01',1,'Synthetic invalid historic link','manual','draft',$2) returning id", [owner, categories[1]])).rows[0].id;
    const auditBefore = (await db.query<{
        n: number;
    }>('select count(*)::int n from financial_record_changes')).rows[0].n;
    await db.exec(await readFile(new URL(migration, dir), 'utf8'));
    assert.equal((await db.query<{
        category_id: string;
    }>('select category_id from financial_records where id=$1', [legacy])).rows[0].category_id, categories[1]);
    assert.equal((await db.query<{
        n: number;
    }>('select count(*)::int n from financial_record_changes')).rows[0].n, auditBefore);
    async function auth(user = owner) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec('set role authenticated'); }
    await auth();
    assert.equal((await db.query('select * from record_category_integrity_issues')).rows.length, 1);
    const input = (await db.query<{
        v: {
            records: {
                id: string;
                category: unknown;
            }[];
        };
    }>('select read_tax_calculation_input(2025) v')).rows[0].v;
    assert.equal(input.records.find(r => r.id === legacy)!.category, null);
    await assert.rejects(db.query("update financial_records set status='approved' where id=$1", [legacy]), /Category must/);
    await db.query('update financial_records set category_id=$1 where id=$2', [categories[0], legacy]);
    const imports: string[] = [];
    for (const format of ['csv', 'bank_statement_pdf'])
        imports.push((await db.query<{
            id: string;
        }>("insert into record_imports(user_id,source_type,status,original_filename) values ($1,$2,'review','synthetic') returning id", [owner, format])).rows[0].id);
    const shared = (await db.query<{
        id: string;
    }>("select id from record_categories where is_default and record_type='expense' limit 1")).rows[0].id;
    for (const table of ['financial_records', 'csv_import_rows', 'bank_statement_import_rows']) {
        const columns = table === 'financial_records' ? 'source_type,status' : 'import_id,row_number,status' + (table === 'bank_statement_import_rows' ? ',redacted_line' : ''), tail = table === 'financial_records' ? "'manual','draft'" : "$3,2,'review'" + (table === 'bank_statement_import_rows' ? ",'synthetic'" : ''), sql = `insert into ${table}(user_id,record_type,record_date,amount,description,category_id,${columns}) values ($1,'expense','2025-08-01',1,'Synthetic owned link',$2,${tail}) returning id`, params = (category: string | null) => table === 'financial_records' ? [owner, category] : [owner, category, imports[table === 'csv_import_rows' ? 0 : 1]];
        for (const bad of [categories[1], categories[2]])
            await assert.rejects(db.query(sql, params(bad)), /Category must/);
        for (const category of [categories[0], shared, null]) {
            const id = (await db.query<{
                id: string;
            }>(sql, params(category))).rows[0].id;
            await assert.rejects(db.query(`update ${table} set category_id=$1 where id=$2`, [categories[1], id]), /Category must/);
            await assert.rejects(db.query(`update ${table} set record_type='income',category_id=$1 where id=$2`, [shared, id]), /Category must/);
        }
    }
    for (const change of ["record_type='income'", "user_id='" + other + "'", "is_default=true,user_id=null", "id='" + randomUUID() + "'"])
        await assert.rejects(db.query('update record_categories set ' + change + ' where id=$1', [categories[0]]), /immutable/);
    await db.query("update record_categories set name='Reviewed new label',sa103_box='unverified legacy metadata' where id=$1", [categories[0]]);
    await assert.rejects(db.query('select guard_owned_record_category()'), /permission denied/);
    await assert.rejects(db.query('select guard_record_category_identity()'), /permission denied/);
    await db.exec('reset role');
    await assert.rejects(db.query("update record_categories set record_type='income' where id=$1", [categories[0]]), /immutable/);
    await auth(other);
    assert.equal((await db.query('select * from record_category_integrity_issues')).rows.length, 0);
    assert.equal((await db.query('select id from financial_records')).rows.length, 0);
});
