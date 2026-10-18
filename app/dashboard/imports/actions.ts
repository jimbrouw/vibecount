"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  normalizeSourceCsv,
  readSourceCsv,
  MAX_SOURCE_BYTES,
  type CsvMapping,
} from "@/lib/records/source-csv";
import { storeSourceCsv } from "@/lib/records/source-store";
import { redactBankDetailsForPrompt } from "@/lib/ai/redaction";

function fail(message: string): never {
  redirect(`/dashboard/imports?error=${encodeURIComponent(message)}`);
}
async function ownerClient() {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (!user || error) redirect("/login");
  return { db, user };
}

export async function createFinancialAccount(form: FormData) {
  const { db, user } = await ownerClient();
  const label = redactBankDetailsForPrompt(
    String(form.get("label") ?? "").trim(),
  );
  const provider = String(form.get("provider") ?? "");
  const mask = String(form.get("mask") ?? "").trim();
  if (
    !label ||
    label.length > 80 ||
    !/^[a-zA-Z0-9]{1,4}$/.test(mask) ||
    !["starling", "nationwide", "amex", "generic"].includes(provider)
  )
    fail("Add a label, provider and the last four characters only.");
  const { error } = await db.from("financial_accounts").insert({
    user_id: user.id,
    label,
    provider,
    masked_identifier: mask,
    account_type: provider === "amex" ? "credit_card" : "bank",
    currency: "GBP",
  });
  if (error)
    fail(
      "Could not save the account label. Check the source-ledger migration.",
    );
  revalidatePath("/dashboard/imports");
  redirect("/dashboard/imports");
}

export async function importSourceCsv(form: FormData) {
  const { db, user } = await ownerClient();
  const accountId = String(form.get("accountId") ?? "");
  const { data: account, error: accountError } = await db
    .from("financial_accounts")
    .select("id,currency")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (accountError || !account)
    fail("Choose one of your saved account labels.");
  if(account.currency!=='GBP') fail('This import requires a GBP account. Foreign sources need the complete reviewed valuation workflow.');
  const file = form.get("sourceFile");
  if (!(file instanceof File) || file.size < 1 || file.size > MAX_SOURCE_BYTES)
    fail("Choose a CSV between 1 byte and 1 MB.");
  if (form.get("mappingConfirmed") !== "yes")
    fail("Preview and confirm the mapping before importing.");
  let result: { import_id: string; created: boolean; transactions: number };
  try {
    const mapping: CsvMapping = JSON.parse(String(form.get("mapping") ?? ""));
    if (!mapping || typeof mapping !== "object")
      throw new Error("Choose a valid field mapping.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const table = readSourceCsv(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    const accountColumn = table[0].findIndex((header) => header.trim().toLowerCase() === "account");
    if (accountColumn >= 0 && new Set(table.slice(1).filter((row) => row.some((cell) => cell.trim()))
      .map((row) => row[accountColumn].trim()).filter(Boolean)).size > 1) {
      throw new Error("This file combines accounts. Upload the original CSV from each bank or card separately; nothing has been imported.");
    }
    const rows = normalizeSourceCsv(table, mapping);
    if (!rows.length) throw new Error("CSV has no transaction rows.");
    result = await storeSourceCsv({
      owner: user.id,
      account: account.id,
      bytes,
      filename: file.name,
      mapping,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : "Could not import CSV.");
  }
  revalidatePath("/dashboard/imports");
  redirect(
    `/dashboard/imports?import=${result.import_id}&result=${result.created ? "staged" : "existing"}`,
  );
}

export async function classifySourceTransaction(form: FormData) {
  const { db } = await ownerClient();
  if (form.get("humanConfirmed") !== "yes")
    fail("Review the amount and confirm this decision.");
  const classification = String(form.get("classification") ?? "Unknown");
  const percent = String(form.get("percent") ?? "").trim();
  if (classification === "Mixed" && !/^\d{1,2}(\.\d{1,2})?$/.test(percent))
    fail("Enter a mixed business percentage between 0 and 100.");
  const [whole, fraction = ""] = percent.split(".");
  const bps =
    classification === "Business"
      ? 10000
      : classification === "Mixed"
        ? Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
        : 0;
  const included = ["Business", "Mixed"].includes(classification);
  const { error } = await db.rpc("review_bank_transaction", {
    p_id: String(form.get("transactionId") ?? ""),
    p_version: Number(form.get("version")),
    p_classification: classification,
    p_category: included ? String(form.get("categoryId") ?? "") || null : null,
    p_bps: bps,
    p_rationale: redactBankDetailsForPrompt(
      String(form.get("rationale") ?? "").trim(),
    ),
  });
  if (error)
    fail(
      "Could not save the decision. Reload, check the category/percentage and resolve any possible duplicate first.",
    );
  revalidatePath("/dashboard/imports");
  revalidatePath("/dashboard/records");
  revalidatePath("/dashboard/tax-prep");
  const importId = String(form.get("importId") ?? "");
  redirect(
    `/dashboard/imports?import=${encodeURIComponent(importId)}&result=reviewed`,
  );
}

export async function reverseSourceImport(form: FormData) {
  const { db } = await ownerClient();
  if (form.get("humanConfirmed") !== "yes")
    fail("Review all import totals before reversing.");
  const id = String(form.get("importId") ?? "");
  const { error } = await db.rpc("reverse_source_import", {
    p_id: id,
    p_stamp: String(form.get("stamp") ?? ""),
    p_reason: redactBankDetailsForPrompt(
      String(form.get("reason") ?? "").trim(),
    ),
  });
  if (error)
    fail(
      "Could not reverse this import. Reload and review its current totals.",
    );
  revalidatePath("/dashboard/imports");
  revalidatePath("/dashboard/records");
  revalidatePath("/dashboard/tax-prep");
  redirect(
    `/dashboard/imports?import=${encodeURIComponent(id)}&result=reversed`,
  );
}

export async function reopenSourceImport(form: FormData) {
  const { db } = await ownerClient();
  if (form.get("humanConfirmed") !== "yes")
    fail("Confirm reopening the import for review.");
  const id = String(form.get("importId") ?? "");
  const { error } = await db.rpc("reopen_source_import", { p_id: id });
  if (error) fail("Could not reopen this import.");
  revalidatePath("/dashboard/imports");
  redirect(`/dashboard/imports?import=${encodeURIComponent(id)}`);
}

/** One explicitly reviewed group per action; retries retain already staged groups. */
export async function importSourceGroup(form: FormData): Promise<{ error?: string; importId?: string; created?: boolean; transactions?: number }> {
  const { db, user } = await ownerClient();
  if (form.get('mappingConfirmed') !== 'yes') return { error: 'Check this account and confirm before importing.' };
  try {
    const file = form.get('sourceFile');
    if (!(file instanceof File) || file.size < 1 || file.size > MAX_SOURCE_BYTES) throw new Error('Choose a CSV up to 1 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const table = readSourceCsv(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    const mapping: CsvMapping = JSON.parse(String(form.get('mapping') ?? ''));
    const { sourceGroups } = await import('@/lib/records/source-groups');
    const groups = sourceGroups(table, mapping);
    const group = groups.find(group => group.scope.value === form.get('group'));
    if (!group) throw new Error('Choose an account group from this file.');
    mapping.accountScope = group.scope;
    const { sourcePlan } = await import("@/lib/records/source-persistence");
    const confirmedMapping = sourcePlan(bytes, mapping, file.name).plan.mapping;
    let accountId = String(form.get('accountId') ?? '');
    if (accountId === 'new') {
      const label = redactBankDetailsForPrompt(String(form.get('label') ?? '').trim());
      const mask = String(form.get('mask') ?? '').trim();
      const provider = String(form.get('provider') ?? '');
      if (!label || label.length > 80 || !/^[A-Za-z0-9]{1,4}$/.test(mask) || !['starling', 'nationwide', 'amex', 'generic'].includes(provider))
        throw new Error('Add an account name, bank/card type and its last four characters.');
      // Stable ID prevents repeated/concurrent submissions creating duplicate labels.
      const { createHash } = await import('node:crypto');
      const hex = createHash('sha256').update(JSON.stringify([user.id, label, mask, provider])).digest('hex');
      accountId = `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
      const exists = await db.from('financial_accounts').select('id').eq('user_id', user.id).eq('id', accountId).maybeSingle();
      if (exists.error) throw new Error('Could not check the account label. Try again.');
      if (!exists.data) {
        const saved = await db.from('financial_accounts').insert({ id: accountId, user_id: user.id, label, provider, masked_identifier: mask, account_type: provider === 'amex' ? 'credit_card' : 'bank', currency: 'GBP' });
        if (saved.error) {
          const retry = await db.from('financial_accounts').select('id').eq('user_id',user.id).eq('id',accountId).maybeSingle();
          if (retry.error || !retry.data) throw new Error('Could not save the account label. Try again.');
        }
      }
    }
    const account = await db.from('financial_accounts').select('id,currency').eq('id', accountId).eq('user_id',user.id).maybeSingle();
    if (account.error || !account.data || account.data.currency !== 'GBP') throw new Error('Choose one of your GBP account labels.');
    const { sourceHash } = await import('@/lib/records/source-crypto');
    const existing = await db.from('record_imports').select('id,metadata').eq('user_id',user.id).eq('account_id',accountId).eq('file_hash',sourceHash(bytes)).maybeSingle();
    if (existing.error) throw new Error('Could not check for an existing import. Try again.');
    function sameScope(metadata: unknown) {
      const saved = metadata as { mapping?: CsvMapping } | null;
      if (!saved?.mapping) return false;
      const keys = ['date','description','amount','debit','credit','currency','reference','dateFormat','amountMode'] as const;
      return keys.every(key => saved.mapping![key] === confirmedMapping[key]) &&
        saved.mapping.accountScope?.column === group!.scope.column && saved.mapping.accountScope?.value === group!.scope.value;
    }
    if (existing.data && !sameScope(existing.data.metadata)) throw new Error('That account already has a different group from this file. Choose a separate account label.');
    const result = await storeSourceCsv({ owner:user.id, account:accountId, bytes, filename:file.name, mapping });
    // Also check the canonical result after registration to cover competing submissions.
    const registered = await db.from('record_imports').select('metadata').eq('id',result.import_id).eq('user_id',user.id).maybeSingle();
    if (registered.error || !sameScope(registered.data?.metadata)) throw new Error('The account already has a different import from this file. Review its saved import before retrying.');
    revalidatePath('/dashboard/imports');
    return { importId:result.import_id, created:result.created, transactions:group.rows.length };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Could not import this group. Previously imported groups are unchanged.' };
  }
}
