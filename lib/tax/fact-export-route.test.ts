import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
test("tax fact export authenticates, scopes the year, pages to empty and rejects changed or unaudited history", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const bundle = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    stdin: {
      resolveDir: root,
      contents:
        "export {GET} from './app/api/tax-prep/facts/export/route.ts';export {fixture} from 'test:db';",
    },
    plugins: [
      {
        name: "inert-export",
        setup(b) {
          b.onResolve(
            { filter: /^(next\/server|@\/lib\/supabase\/server|test:db)$/ },
            (a) => ({
              path: a.path === "@/lib/supabase/server" ? "test:db" : a.path,
              namespace: "fixture",
            }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            loader: "js",
            contents:
              a.path === "next/server"
                ? "export class NextResponse extends Response{static json(data,init){return new Response(JSON.stringify(data),init)}}"
                : `
      export const fixture={signedIn:true,reads:[],audit:[],stamp:0,changed:false,failRead:false,failAudit:false};
      export async function createClient(){return {auth:{getUser:async()=>({data:{user:fixture.signedIn?{id:'owner'}:null},error:null})},rpc:async()=>({data:fixture.changed&&fixture.stamp++?'b'.repeat(32):'a'.repeat(32),error:null}),from(table){let cursor=null;const filters=[];let mutation=false;
      const q={select(){return q},eq(k,v){filters.push([k,v]);return q},order(){return q},limit(){return q},gt(k,v){cursor=v;return q},insert(v){mutation=true;fixture.audit.push(v);return q},then(resolve){if(mutation)return Promise.resolve({error:fixture.failAudit?{}:null}).then(resolve);fixture.reads.push({table,cursor,filters});const rows=table==='tax_section_attestations'?[{id:'1',rationale:'Synthetic batch'},{id:'2',rationale:'Second batch'},{id:'3',rationale:'Third batch'}]:[];return Promise.resolve({data:rows.filter(r=>!cursor||r.id>cursor).slice(0,1),error:fixture.failRead?{}:null}).then(resolve)}};return q}}}`,
          }));
        },
      },
    ],
  });
  const m = await import(
      "data:text/javascript;base64," +
        Buffer.from(bundle.outputFiles[0].text).toString("base64")
    ),
    f = m.fixture;
  f.signedIn = false;
  assert.equal(
    (
      await m.GET(
        new Request("http://localhost/api/tax-prep/facts/export?year=2025"),
      )
    ).status,
    401,
  );
  assert.equal(f.reads.length, 0);
  f.signedIn = true;
  assert.equal(
    (
      await m.GET(
        new Request("http://localhost/api/tax-prep/facts/export?year=invalid"),
      )
    ).status,
    400,
  );
  const response = await m.GET(
    new Request("http://localhost/api/tax-prep/facts/export?year=2025"),
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.snapshot.sections.length, 3);
  assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.ok(
    f.reads.every((r: { filters: unknown[] }) =>
      JSON.stringify(r.filters).includes('["user_id","owner"]'),
    ),
  );
  assert.ok(
    f.reads.every((r: { filters: unknown[] }) =>
      JSON.stringify(r.filters).includes('["tax_year_start",2025]'),
    ),
  );
  assert.equal(f.audit[0].tax_year_start, 2025);
  assert.equal(f.audit.length, 1);
  f.changed = true;
  f.stamp = 0;
  assert.equal(
    (
      await m.GET(
        new Request("http://localhost/api/tax-prep/facts/export?year=2025"),
      )
    ).status,
    503,
  );
  assert.equal(f.audit.length, 1);
  f.changed = false;
  f.failRead = true;
  assert.equal(
    (
      await m.GET(
        new Request("http://localhost/api/tax-prep/facts/export?year=2025"),
      )
    ).status,
    503,
  );
  assert.equal(f.audit.length, 1);
  f.failRead = false;
  f.failAudit = true;
  assert.equal(
    (
      await m.GET(
        new Request("http://localhost/api/tax-prep/facts/export?year=2025"),
      )
    ).status,
    503,
  );
});
