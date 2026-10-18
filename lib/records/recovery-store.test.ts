import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

test("recovery adapter resolves committed retries before keys and recovers a concurrent lost success", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    stdin: {
      resolveDir: root,
      contents:
        "export {recoverEvidenceAttempt} from './lib/records/recovery-store.ts';export {fixture} from 'test:recovery-db';",
    },
    plugins: [
      {
        name: "isolated-recovery",
        setup(builder) {
          builder.onResolve(
            {
              filter:
                /^(server-only|test:recovery-db)$|supabase\/admin$|\.\/evidence-key$|\.\/evidence-recovery$/,
            },
            (args) => ({
              path:
                args.path === "test:recovery-db" ||
                args.path.endsWith("supabase/admin")
                  ? "db"
                  : args.path,
              namespace: "fixture",
            }),
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "js",
            contents:
              args.path === "server-only"
                ? ""
                : args.path.endsWith("evidence-key")
                  ? "export function loadEvidenceKeyring(){throw new Error('Keys must not be loaded for committed recovery')} "
                  : args.path.endsWith("evidence-recovery")
                    ? "export function verifySourceRecovery(){throw new Error('Unexpected decrypt')};export const verifyDocumentRecovery=verifySourceRecovery;export const verifiedBytes=verifySourceRecovery;"
                    : `export const fixture={mode:'replay',lookups:0,checks:0,result:{import_id:'canonical',created:true,transactions:8}};export function createAdminClient(){return {async rpc(name){if(name!=='assert_evidence_attempt_retained')throw new Error('Unexpected RPC');fixture.checks++;return {data:fixture.mode==='deleted'||(fixture.mode==='deleted-race'&&fixture.checks>1)?false:true,error:null}},from(table){const q={select(){return q},eq(){return q},async maybeSingle(){if(table==='evidence_recovery_requests'){fixture.lookups++;if(['race','deleted-race'].includes(fixture.mode)&&fixture.lookups===1)return {data:null,error:null};return {data:{kind:'source',source_attempt_id:'attempt',document_attempt_id:null,expected_stamp:'stamp',reason:'Checked recovery',result:fixture.result},error:null}}if(table==='evidence_recovery_attempts')return {data:{stamp:'changed-after-concurrent-commit'},error:null};throw new Error('Unexpected read')}};return q}}}`,
          }));
        },
      },
    ],
  });
  const m = await import(
    "data:text/javascript;base64," +
      Buffer.from(result.outputFiles[0].text).toString("base64")
  );
  const input = {
    owner: "owner",
    kind: "source",
    attempt: "attempt",
    stamp: "stamp",
    request: "request",
    reason: "Checked recovery",
  };
  assert.deepEqual(await m.recoverEvidenceAttempt(input), m.fixture.result);
  assert.equal(m.fixture.lookups, 1);
  m.fixture.mode = "race";
  m.fixture.lookups = 0;
  assert.deepEqual(await m.recoverEvidenceAttempt(input), m.fixture.result);
  assert.equal(m.fixture.lookups, 2);
  await assert.rejects(
    m.recoverEvidenceAttempt({ ...input, reason: "Different request body" }),
    /different review/,
  );
  m.fixture.mode = 'deleted';m.fixture.lookups=0;m.fixture.checks=0;
  await assert.rejects(m.recoverEvidenceAttempt(input), /marked for deletion/);
  assert.equal(m.fixture.lookups,0);
  m.fixture.mode = 'deleted-race';m.fixture.lookups=0;m.fixture.checks=0;
  await assert.rejects(m.recoverEvidenceAttempt(input), /marked for deletion/);
  assert.equal(m.fixture.lookups,1);
});
