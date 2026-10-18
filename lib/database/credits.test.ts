import assert from "node:assert/strict";
import test from "node:test";
import { refundReversalClosure, type RefundClosureCatalog } from '../records/refund-closure';
import { sourceImportReversalReview, type ImportReversalContext } from '../records/import-reversal';
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { TEST_SCHEMA_BOOTSTRAP } from "./test-schema.ts";

test("reviewed invoice credits preserve entitlement, penny rounding, provenance and zero accounting effects", async (t) => {
  const db = new PGlite({ extensions: { pgcrypto } });
  t.after(() => db.close());
  await db.exec(TEST_SCHEMA_BOOTSTRAP);
  const dir = new URL("../../supabase/migrations/", import.meta.url);
  const migrations = (await readdir(dir))
    .filter((n) => n.endsWith(".sql"))
    .sort();
  for (const name of migrations.filter((n) => n < "20261017150000"))
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  const owner = randomUUID(),
    other = randomUUID(),
    client = randomUUID(),
    known = randomUUID(),
    legacy = randomUUID();
  await db.query<Record<string, unknown>>(
    "insert into auth.users values ($1),($2)",
    [owner, other],
  );
  await db.query<Record<string, unknown>>(
    "insert into clients(id,user_id,name) values($1,$2,'Synthetic client')",
    [client, owner],
  );
  await db.query<Record<string, unknown>>(
    "insert into invoices(id,user_id,client_id,number,invoice_date,description,amount,status) values ($1,$3,$4,'VAT-1','2026-04-05','Synthetic work',120,'finalised'),($2,$3,$4,'UNKNOWN-1','2026-04-05','Legacy work',100,'finalised')",
    [known, legacy, owner, client],
  );
  for (const name of migrations.filter((n) => n >= "20261017150000"))
    await db.exec(await readFile(new URL(name, dir), "utf8"));
  async function asUser(id: string = owner) {
    await db.exec("reset role");
    await db.query<Record<string, unknown>>(
      "select set_config('request.jwt.claim.sub',$1,false)",
      [id],
    );
    await db.exec("set role authenticated");
  }
  async function object(path: string) {
    await db.exec("reset role");
    await db.query<Record<string, unknown>>(
      "insert into storage.objects(bucket_id,name) values ('invoices',$1)",
      [path],
    );
    await asUser();
  }
  async function balance(invoice: string = known) {
    return (
      await db.query<Record<string, unknown>>(
        "select * from invoice_credit_choices where id=$1",
        [invoice],
      )
    ).rows[0];
  }
  await asUser();
  const revision = randomUUID(),
    initial = await balance();
  await object(`${owner}/revisions/${revision}.pdf`);
  await db.query<Record<string, unknown>>(
    "select save_invoice_revision($1,$2,$3,$4::jsonb,$5,$6)",
    [
      known,
      revision,
      initial.updated_at,
      JSON.stringify({
        client_id: client,
        number: "VAT-1",
        invoice_date: "2026-04-05",
        due_date: "2026-05-05",
        description: "Synthetic work",
        payment_terms: "30 days",
        net_pence: 10000,
        vat_pence: 2000,
        vat_rate_bps: 2000,
        vat_enabled: true,
        vat_number: "GB-SYNTHETIC",
        reason: "Verified original evidence",
        pdf: {},
        legacy_confirmed: true,
      }),
      `${owner}/revisions/${revision}.pdf`,
      "a".repeat(64),
    ],
  );
  async function prepare(
    invoice: string,
    gross: number,
    patch: Record<string, unknown> = {},
  ) {
    const b = await balance(invoice),
      credit = randomUUID(),
      path = `${owner}/credits/${credit}.pdf`;
    const net =
      b.net_pence === null
        ? null
        : Math.round(
            ((Number(b.credited_pence) + gross) * Number(b.net_pence)) /
              Number(b.invoice_pence),
          ) - Number(b.credited_net_pence);
    const document = {
      number: `CN-${b.number}-${String(b.next_ordinal).padStart(3, "0")}`,
      creditDate: "2026-04-06",
      invoiceNumber: b.number,
      invoiceDate: new Date(String(b.invoice_date)).toISOString().slice(0, 10),
      description: b.description,
      sellerName: "Synthetic supplier",
      sellerAddress: "",
      clientName: "Synthetic client",
      clientAddress: "",
      reason: "Reviewed credit",
      grossPence: gross,
      netPence: net,
      vatPence: net === null ? null : gross - net,
      taxStatus: net === null ? "unverified" : "invoice_snapshot",
      vatRateBps: net === null ? null : b.vat_rate_bps,
      vatNumber: net === null ? "" : b.vat_number_snapshot,
      reviewHash: "b".repeat(64),
      ...patch,
    };
    await object(path);
    return { invoice, credit, stamp: b.balance_stamp, path, document, gross };
  }
  const approve = async (p: Awaited<ReturnType<typeof prepare>>) =>
    (
      await db.query<{ result: Record<string, unknown> }>(
        "select approve_invoice_credit($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9) result",
        [
          p.invoice,
          p.credit,
          p.stamp,
          p.document.creditDate,
          p.gross,
          "Reviewed credit",
          JSON.stringify(p.document),
          p.path,
          "c".repeat(64),
        ],
      )
    ).rows[0].result;
  const reverse = async (
    credit: string,
    stamp: unknown,
    request = randomUUID(),
  ) =>
    (
      await db.query<Record<string, unknown>>(
        "select reverse_invoice_credit($1,$2,'Reviewed reversal',$3) result",
        [credit, stamp, request],
      )
    ).rows[0].result;
  const first = await prepare(known, 1),
    result = await approve(first);
  assert.equal(result.recognized_income_change_pence, 0);
  assert.deepEqual(await approve(first), result);
  await assert.rejects(approve({ ...first, gross: 2 }), /request changed/);
  assert.equal(Number((await balance()).credited_net_pence), 1);
  assert.equal(Number((await balance()).credited_vat_pence), 0);
  const stale = await prepare(known, 100);
  const second = await prepare(known, 2);
  await approve(second);
  assert.equal(Number((await balance()).credited_net_pence), 3);
  await assert.rejects(approve(stale), /balance changed/);
  await assert.rejects(
    reverse(first.credit, (await balance()).balance_stamp),
    /latest active credit/,
  );
  const reverseId = randomUUID(),
    stamp = (await balance()).balance_stamp;
  const reversal = await reverse(second.credit, stamp, reverseId);
  assert.deepEqual(await reverse(second.credit, stamp, reverseId), reversal);
  const rest = await prepare(known, 11999);
  await approve(rest);
  const full = await balance();
  assert.equal(Number(full.credited_net_pence), 10000);
  assert.equal(Number(full.credited_vat_pence), 2000);
  assert.equal(Number(full.outstanding_pence), 0);
  assert.equal(full.settlement_state, "fully_credited");
  assert.equal(full.paid_at, null);
  await assert.rejects(approve(await prepare(known, 1)), /exceeds remaining/);
  await reverse(rest.credit, full.balance_stamp);
  await reverse(first.credit, (await balance()).balance_stamp);
  const rev2 = randomUUID();
  await object(`${owner}/revisions/${rev2}.pdf`);
  await assert.rejects(
    db.query<Record<string, unknown>>(
      "update invoices set description='Changed' where id=$1",
      [known],
    ),
    /reviewed invoice revision|credit history/,
  );
  await assert.rejects(
    db.query<Record<string, unknown>>("delete from invoices where id=$1", [
      known,
    ]),
    /credit history/,
  );
  const unknown = await prepare(legacy, 3000);
  await approve(unknown);
  const stored = (
    await db.query<Record<string, unknown>>(
      "select * from invoice_credit_notes where id=$1",
      [unknown.credit],
    )
  ).rows[0];
  assert.equal(stored.net_pence, null);
  assert.equal(stored.vat_pence, null);
  assert.equal(stored.tax_status, "unverified");
  assert.equal(Number((await balance(legacy)).outstanding_pence), 7000);
  await assert.rejects(
    approve(await prepare(legacy, 1, { creditDate: "2999-01-01" })),
    /between invoice date and today/,
  );
  await assert.rejects(
    approve(await prepare(legacy, 1, { description: "Different supply" })),
    /does not match/,
  );
  await assert.rejects(
    db.query<Record<string, unknown>>(
      "update invoice_credit_notes set rationale='changed' where id=$1",
      [unknown.credit],
    ),
    /permission denied/,
  );
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        "select count(*) n from financial_records",
      )
    ).rows[0].n,
    0,
  );
  // Use the real receipt-review/allocation path for a fully paid invoice.
  await db.exec("reset role");
  const account = (
    await db.query<Record<string, unknown>>(
      "insert into financial_accounts(user_id,label,provider,account_type,masked_identifier) values ($1,'Synthetic bank','starling','bank','1234') returning id",
      [owner],
    )
  ).rows[0].id;
  const upload = randomUUID();
  await db.query<Record<string, unknown>>(
    "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,'fixture/credit.enc','test',100,'uploaded')",
    [upload, owner, account, "d".repeat(64)],
  );
  await db.exec(
    "insert into storage.objects(bucket_id,name) values ('source-evidence','fixture/credit.enc'); set role service_role",
  );
  await db.query<Record<string, unknown>>(
    "select ingest_source_csv($1,$2,'synthetic.csv','mapped-csv/1','{}',$3::jsonb)",
    [
      owner,
      upload,
      JSON.stringify([
        {
          row_number: 2,
          row_hash: "e".repeat(64),
          raw_encrypted: "synthetic",
          date: "2026-04-05",
          signed_pence: 12000,
          currency: "GBP",
          description: "Synthetic receipt",
          reference: "VAT-1",
          fingerprint: "f".repeat(64),
        },
      ]),
    ],
  );
  await asUser();
  const tx = (
    await db.query<Record<string, unknown>>("select * from bank_transactions")
  ).rows[0];
  const category = (
    await db.query<Record<string, unknown>>(
      "select id from record_categories where is_default and record_type='income' limit 1",
    )
  ).rows[0].id;
  await db.query<Record<string, unknown>>(
    "select review_bank_transaction($1,0,'Business',$2,10000,'Reviewed receipt')",
    [tx.id, category],
  );
  const b = await balance();
  await db.query<Record<string, unknown>>(
    "select approve_invoice_allocations($1,1,$2::jsonb,'Reviewed match',$3,0)",
    [
      tx.id,
      JSON.stringify([
        {
          invoice_id: known,
          invoice_updated_at: b.updated_at,
          amount_pence: 12000,
        },
      ]),
      randomUUID(),
    ],
  );
  assert.equal((await balance()).settlement_state, "settled");
  await db.exec("reset role");
  await db.query<Record<string, unknown>>(
    "insert into invoice_reminders(user_id,invoice_id,client_id,recipient_email,subject,message,status) values ($1,$2,$3,'test@example.invalid','Draft','Old gross','pending')",
    [owner, known, client],
  );
  await asUser();
  const paidCredit = await prepare(known, 3000);
  await approve(paidCredit);
  const paid = await balance();
  assert.equal(Number(paid.refund_due_pence), 3000);
  assert.equal(paid.settlement_state, "refund_due");
  assert.equal(paid.paid_at, null);
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        "select status from invoice_reminders where invoice_id=$1",
        [known],
      )
    ).rows[0].status,
    "skipped",
  );
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        "select count(*) n from financial_records where status='approved'",
      )
    ).rows[0].n,
    1,
  );
  // A bank customer refund changes the ledger once; assigning it only reconciles cash.
  await db.exec("reset role");
  const refundUpload = randomUUID();
  await db.query(
    "insert into source_upload_attempts(id,user_id,account_id,file_hash,object_path,key_id,size_bytes,state) values ($1,$2,$3,$4,'fixture/assigned-refund.enc','test',100,'uploaded')",
    [refundUpload, owner, account, "9".repeat(64)],
  );
  await db.exec(
    "insert into storage.objects(bucket_id,name) values ('source-evidence','fixture/assigned-refund.enc');set role service_role",
  );
  const refundImport = (
    await db.query<{ result: { import_id: string } }>(
      "select ingest_source_csv($1,$2,'refund.csv','mapped-csv/1','{}',$3::jsonb) result",
      [
        owner,
        refundUpload,
        JSON.stringify([
          {
            row_number: 2,
            row_hash: "8".repeat(64),
            raw_encrypted: "synthetic",
            date: "2026-04-06",
            signed_pence: -3000,
            currency: "GBP",
            description: "Recorded customer refund",
            reference: "",
            fingerprint: "7".repeat(64),
          },
        ]),
      ],
    )
  ).rows[0].result.import_id;
  await asUser();
  const refundTx = (
    await db.query<{ id: string }>(
      "select id from bank_transactions where import_id=$1",
      [refundImport],
    )
  ).rows[0].id;
  const refundStamp = (
    await db.query<{ s: string }>("select refund_group_stamp($1) s", [tx.id])
  ).rows[0].s;
  await db.query(
    "select approve_refund($1,1,$2,0,$3,'Recorded customer return',$4)",
    [tx.id, refundTx, refundStamp, randomUUID()],
  );
  const refundLink = (
    await db.query<{ id: string }>(
      "select id from active_refunds where refund_transaction_id=$1",
      [refundTx],
    )
  ).rows[0].id;
  const allocation = (
    await db.query<{ id: string }>(
      "select id from active_invoice_allocations where invoice_id=$1",
      [known],
    )
  ).rows[0].id;
  const stampNow = async () =>
    (await db.query<{ s: string }>("select reconciliation_export_stamp() s"))
      .rows[0].s;
  const ledgerNow = async () =>
    (
      await db.query(
        "select sum(amount*100*effect_sign)::bigint pence,count(*)::int n from financial_records where status='approved' and record_type='income'",
      )
    ).rows;
  const assignment = async (
    amount: number,
    request = randomUUID(),
    stamp: string | undefined = undefined,
    creditId = paidCredit.credit,
    allocationId = allocation,
  ) =>
    (
      await db.query<{ result: { assignment_id: string } }>(
        "select approve_invoice_refund_assignment($1,$2,$3,$4,$5,'Reviewed returned cash',$6) result",
        [
          creditId,
          allocationId,
          refundLink,
          amount,
          stamp ?? (await stampNow()),
          request,
        ],
      )
    ).rows[0].result;
  const unassign = async (
    id: string,
    request = randomUUID(),
    stamp: string | undefined = undefined,
  ) =>
    (
      await db.query<{ result: Record<string, unknown> }>(
        "select reverse_invoice_refund_assignment($1,$2,'Reviewed unmatch',$3) result",
        [id, stamp ?? (await stampNow()), request],
      )
    ).rows[0].result;
  const baselineLedger = await ledgerNow();
  await assert.rejects(
    assignment(1, randomUUID(), undefined, unknown.credit, allocation),
    /original receipt allocation/,
  );
  const importBefore = (
    await db.query<{ s: { stamp: string } }>(
      "select source_import_summary($1) s",
      [refundImport],
    )
  ).rows[0].s.stamp;
  const invoiceBefore = (await balance()).balance_stamp;
  const groupBefore = (
    await db.query<{ s: string }>("select refund_group_stamp($1) s", [tx.id])
  ).rows[0].s;
  const request = randomUUID(),
    expected = await stampNow();
  const a1 = await assignment(1000, request, expected);
  assert.deepEqual(await assignment(1000, request, expected), a1);
  await assert.rejects(assignment(1001, request, expected), /request changed/);
  assert.equal(Number((await balance()).returned_pence), 1000);
  assert.equal(Number((await balance()).refund_due_pence), 2000);
  await assert.rejects(
    assignment(1, randomUUID(), expected),
    /Reconciliation changed/,
  );
  const a2 = await assignment(2000);
  const refundGraph = (await db.query<{g:RefundClosureCatalog}>("select read_refund_reversal_graph('refund',$1) g", [refundTx])).rows[0].g;
  assert.equal(refundGraph.links[0].assignment_count, 2);
  assert.equal(refundGraph.assignments.length, 2);
  const closure = refundReversalClosure(owner, {kind:'refund',id:refundTx}, refundGraph);
  assert.equal(closure.blocked, true);
  assert.deepEqual(closure.blocking_assignment_ids, [a1.assignment_id,a2.assignment_id].sort());
  await assert.rejects(db.query("select reverse_refund_closure('refund',$1,$2,'Blocked full reversal',$3)", [refundTx,refundGraph.stamp,randomUUID()]), /every linked invoice refund assignment/);
  assert.deepEqual((await db.query<{g:RefundClosureCatalog}>("select read_refund_reversal_graph('refund',$1) g", [refundTx])).rows[0].g, refundGraph);
  assert.equal(Number((await balance()).retained_cash_pence), 9000);
  assert.equal((await balance()).settlement_state, "settled");
  assert.equal(Number((await balance()).refund_due_pence), 0);
  assert.notEqual((await balance()).balance_stamp, invoiceBefore);
  assert.notEqual(
    (await db.query<{ s: string }>("select refund_group_stamp($1) s", [tx.id]))
      .rows[0].s,
    groupBefore,
  );
  const summary = (
    await db.query<{ s: { stamp: string; refund_assignment_count: number } }>(
      "select source_import_summary($1) s",
      [refundImport],
    )
  ).rows[0].s;
  assert.notEqual(summary.stamp, importBefore);
  assert.equal(summary.refund_assignment_count, 2);
  await assert.rejects(assignment(1), /remaining refund cash/);
  await assert.rejects(
    db.query("select reverse_invoice_allocation($1,'Parent reversal',$2)", [
      allocation,
      randomUUID(),
    ]),
    /Reverse invoice refund assignments/,
  );
  await assert.rejects(
    reverse(paidCredit.credit, (await balance()).balance_stamp),
    /Reverse invoice refund assignments/,
  );
  const groupStamp = (
    await db.query<{ s: string }>("select refund_group_stamp($1) s", [tx.id])
  ).rows[0].s;
  await assert.rejects(
    db.query("select reverse_refund_group($1,$2,'Parent group reversal',$3)", [
      tx.id,
      groupStamp,
      randomUUID(),
    ]),
    /Reverse invoice refund assignments/,
  );
  for (const importId of [refundImport, tx.import_id]) {
    const context=(await db.query<{c:ImportReversalContext}>('select read_source_import_reversal_context($1) c',[importId])).rows[0].c;
    const reviewed=sourceImportReversalReview(owner,context);assert.equal(reviewed.blocked,true);assert.deepEqual(reviewed.blocking_assignment_ids,[a1.assignment_id,a2.assignment_id].sort());
    await assert.rejects(db.query("select reverse_source_import_reviewed($1,$2,'Blocked reviewed import reversal',$3)",[importId,context.financial_stamp,randomUUID()]),/every linked invoice refund assignment/);

    const summary = (
      await db.query<{ s: { stamp: string } }>(
        "select source_import_summary($1) s",
        [importId],
      )
    ).rows[0].s;
    await assert.rejects(
      db.query("select reverse_source_import($1,$2,'Parent import reversal')", [
        importId,
        summary.stamp,
      ]),
      /Reverse invoice refund assignments/,
    );
  }
  assert.deepEqual(await ledgerNow(), baselineLedger);
  await assert.rejects(
    db.query(
      "update invoice_refund_assignments set amount_pence=1 where id=$1",
      [a1.assignment_id],
    ),
    /permission denied/,
  );
  await asUser(other);
  assert.equal(
    (await db.query("select * from invoice_refund_assignments")).rows.length,
    0,
  );
  await assert.rejects(assignment(1), /not found/);
  await asUser();
  const undoStamp = await stampNow(),
    undoRequest = randomUUID();
  const undo = await unassign(a1.assignment_id, undoRequest, undoStamp);
  assert.deepEqual(
    await unassign(a1.assignment_id, undoRequest, undoStamp),
    undo,
  );
  assert.equal(Number((await balance()).refund_due_pence), 1000);
  await unassign(a2.assignment_id);
  assert.deepEqual(await ledgerNow(), baselineLedger);
  // Reuse released receipt cash against a partially funded credited invoice.
  const released = (
    await db.query<{
      result: {
        restored_outstanding_pence: number;
        released_allocation_pence: number;
      };
    }>(
      "select reverse_invoice_allocation($1,'Move reviewed match',$2) result",
      [allocation, randomUUID()],
    )
  ).rows[0].result;
  assert.equal(released.restored_outstanding_pence, 9000);
  assert.equal(released.released_allocation_pence, 12000);
  const legacyBalance = await balance(legacy);
  await db.query(
    "select approve_invoice_allocations($1,1,$2::jsonb,'Partial credited invoice',$3,0)",
    [
      tx.id,
      JSON.stringify([
        {
          invoice_id: legacy,
          invoice_updated_at: legacyBalance.updated_at,
          amount_pence: 7000,
        },
      ]),
      randomUUID(),
    ],
  );
  const legacyAllocation = (
    await db.query<{ id: string }>(
      "select id from active_invoice_allocations where invoice_id=$1",
      [legacy],
    )
  ).rows[0].id;
  const legacyAssignment = await assignment(
    3000,
    randomUUID(),
    undefined,
    unknown.credit,
    legacyAllocation,
  );
  assert.equal(Number((await balance(legacy)).outstanding_pence), 3000);
  const partial = await balance(legacy);
  await db.query(
    "select approve_invoice_allocations($1,1,$2::jsonb,'Remaining retained cash',$3,7000)",
    [
      tx.id,
      JSON.stringify([
        {
          invoice_id: legacy,
          invoice_updated_at: partial.updated_at,
          amount_pence: 3000,
        },
      ]),
      randomUUID(),
    ],
  );
  assert.equal(Number((await balance(legacy)).allocated_pence), 10000);
  assert.equal(Number((await balance(legacy)).retained_cash_pence), 7000);
  assert.equal((await balance(legacy)).settlement_state, "settled");
  assert.deepEqual(await ledgerNow(), baselineLedger);
  await unassign(legacyAssignment.assignment_id);
  const toReverse = (
    await db.query<{ s: { stamp: string } }>(
      "select source_import_summary($1) s",
      [tx.import_id],
    )
  ).rows[0].s;
  await db.query(
    "select reverse_source_import($1,$2,'Reviewed original import reversal')",
    [tx.import_id, toReverse.stamp],
  );
  assert.equal(
    (await db.query("select * from active_invoice_refund_assignments")).rows
      .length,
    0,
  );
  assert.equal((await db.query("select * from active_refunds")).rows.length, 0);
  assert.equal(
    (await db.query("select * from active_invoice_allocations")).rows.length,
    0,
  );
  assert.ok(
    (await db.query("select * from active_invoice_credits")).rows.length > 0,
  );
  await db.query("select reopen_source_import($1)", [tx.import_id]);
  assert.equal(
    (await db.query("select * from active_invoice_refund_assignments")).rows
      .length,
    0,
  );
  await asUser(other);
  assert.equal(
    (
      await db.query<Record<string, unknown>>(
        "select * from invoice_credit_notes",
      )
    ).rows.length,
    0,
  );
  await assert.rejects(approve(paidCredit), /Choose your/);
  await assert.rejects(
    reverse(paidCredit.credit, paid.balance_stamp),
    /not found/,
  );
  await db.exec("reset role;set role anon");
  await assert.rejects(approve(paidCredit), /permission denied/);
  await assert.rejects(
    db.query(
      "select approve_invoice_refund_assignment($1,$2,$3,1,$4,'Anonymous attempt',$5)",
      [paidCredit.credit, allocation, refundLink, "a".repeat(32), randomUUID()],
    ),
    /permission denied/,
  );
});
