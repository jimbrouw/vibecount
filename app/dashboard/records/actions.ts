"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseBankStatementText } from "@/lib/records/bank-statement";
import { parseRecordsCsv, type CsvCategory } from "@/lib/records/csv";
import {
  normaliseRecordStatus,
  validateManualRecordInput,
  type RecordType,
} from "@/lib/records/validation";

export async function createManualRecord(formData: FormData) {
  const userId = await requireUserId();
  const parsed = validateManualRecordInput(readRecordForm(formData));

  if (!parsed.ok) {
    redirect(`/dashboard/records?error=${encodeURIComponent(parsed.error)}`);
  }

  const supabase = await createClient();
  const category = await getOwnedCategory(
    supabase,
    userId,
    parsed.value.categoryId,
    parsed.value.recordType
  );

  if (!category) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Choose a valid category.")}`
    );
  }

  const { error } = await supabase.from("financial_records").insert({
    user_id: userId,
    record_type: parsed.value.recordType,
    record_date: parsed.value.recordDate,
    description: parsed.value.description,
    amount: parsed.value.amountPence / 100,
    category_id: parsed.value.categoryId,
    source_type: "manual",
    status: parsed.value.status,
    approved_at:
      parsed.value.status === "approved" ? new Date().toISOString() : null,
  });

  if (error) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not save this record.")}`
    );
  }

  revalidatePath("/dashboard/records");
  redirect("/dashboard/records?created=1");
}

export async function updateManualRecord(formData: FormData) {
  const userId = await requireUserId();
  const recordId = String(formData.get("recordId") ?? "");
  const parsed = validateManualRecordInput(readRecordForm(formData));

  if (!recordId) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Choose a record to update.")}`
    );
  }

  if (!parsed.ok) {
    redirect(`/dashboard/records?error=${encodeURIComponent(parsed.error)}`);
  }

  const supabase = await createClient();
  const category = await getOwnedCategory(
    supabase,
    userId,
    parsed.value.categoryId,
    parsed.value.recordType
  );

  if (!category) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Choose a valid category.")}`
    );
  }

  const { error } = await supabase
    .from("financial_records")
    .update({
      record_type: parsed.value.recordType,
      record_date: parsed.value.recordDate,
      description: parsed.value.description,
      amount: parsed.value.amountPence / 100,
      category_id: parsed.value.categoryId,
      status: parsed.value.status,
      approved_at:
        parsed.value.status === "approved" ? new Date().toISOString() : null,
    })
    .eq("id", recordId)
    .eq("user_id", userId);

  if (error) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not update this record.")}`
    );
  }

  revalidatePath("/dashboard/records");
  redirect("/dashboard/records?updated=1");
}

export async function setManualRecordStatus(formData: FormData) {
  const userId = await requireUserId();
  const recordId = String(formData.get("recordId") ?? "");
  const status = normaliseRecordStatus(String(formData.get("status") ?? ""));

  if (!recordId) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Choose a record to review.")}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("financial_records")
    .update({
      status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
    })
    .eq("id", recordId)
    .eq("user_id", userId);

  if (error) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not review this record.")}`
    );
  }

  revalidatePath("/dashboard/records");
  redirect("/dashboard/records?reviewed=1");
}

export async function uploadRecordsCsv(formData: FormData) {
  const userId = await requireUserId();
  const file = formData.get("csvFile");

  if (!(file instanceof File) || file.size === 0) {
    redirect(`/dashboard/records?error=${encodeURIComponent("Choose a CSV file.")}`);
  }

  if (file.size > 1_000_000) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("CSV file must be under 1MB.")}`
    );
  }

  const supabase = await createClient();
  const categories = await getCategories(supabase, userId);
  const parsed = parseRecordsCsv(await file.text(), categories);

  if (!parsed.ok) {
    redirect(`/dashboard/records?error=${encodeURIComponent(parsed.error)}`);
  }

  const { data: importRow, error: importError } = await supabase
    .from("record_imports")
    .insert({
      user_id: userId,
      source_type: "csv",
      original_filename: file.name || "records.csv",
      status: "review",
      metadata: {
        row_count: parsed.rows.length,
      },
    })
    .select("id")
    .single();

  if (importError || !importRow) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not create the CSV import.")}`
    );
  }

  const { error: rowsError } = await supabase.from("csv_import_rows").insert(
    parsed.rows.map((row) => ({
      user_id: userId,
      import_id: importRow.id,
      row_number: row.rowNumber,
      record_type: row.recordType,
      record_date: row.recordDate,
      description: row.description || null,
      amount: row.amountPence === null ? null : row.amountPence / 100,
      category_id: row.categoryId,
      status: row.errorMessage ? "invalid" : "review",
      error_message: row.errorMessage,
      raw_row: row.rawRow,
    }))
  );

  if (rowsError) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not stage CSV rows.")}`
    );
  }

  revalidatePath("/dashboard/records");
  redirect(`/dashboard/records?csvImported=${parsed.rows.length}`);
}

export async function setCsvImportRowStatus(formData: FormData) {
  const userId = await requireUserId();
  const rowId = String(formData.get("rowId") ?? "");
  const status = String(formData.get("status") ?? "") === "discarded" ? "discarded" : "approved";

  if (!rowId) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Choose a CSV row to update.")}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("csv_import_rows")
    .update({ status })
    .eq("id", rowId)
    .eq("user_id", userId)
    .in("status", ["review", "approved", "discarded"]);

  if (error) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not update the CSV row.")}`
    );
  }

  revalidatePath("/dashboard/records");
  redirect("/dashboard/records?csvReviewed=1");
}

export async function commitApprovedCsvRows() {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data: rows, error: rowsError } = await supabase
    .from("csv_import_rows")
    .select("id, import_id, record_type, record_date, description, amount, category_id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .not("record_date", "is", null)
    .not("description", "is", null)
    .not("amount", "is", null)
    .not("category_id", "is", null)
    .limit(100);

  if (rowsError) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not read approved CSV rows.")}`
    );
  }

  if (!rows || rows.length === 0) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Approve at least one valid CSV row first.")}`
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("financial_records")
    .insert(
      rows.map((row) => ({
        user_id: userId,
        record_type: row.record_type,
        record_date: row.record_date,
        description: row.description,
        amount: row.amount,
        category_id: row.category_id,
        import_id: row.import_id,
        source_type: "csv",
        source_reference: `CSV row ${row.id}`,
        status: "approved",
        approved_at: new Date().toISOString(),
      }))
    )
    .select("id");

  if (insertError || !inserted) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not commit approved CSV rows.")}`
    );
  }

  for (let index = 0; index < rows.length; index += 1) {
    await supabase
      .from("csv_import_rows")
      .update({
        status: "committed",
        committed_record_id: inserted[index]?.id ?? null,
      })
      .eq("id", rows[index].id)
      .eq("user_id", userId);
  }

  await supabase
    .from("record_imports")
    .update({
      status: "committed",
      committed_at: new Date().toISOString(),
    })
    .in("id", [...new Set(rows.map((row) => row.import_id))])
    .eq("user_id", userId);

  revalidatePath("/dashboard/records");
  redirect(`/dashboard/records?csvCommitted=${inserted.length}`);
}

export async function uploadBankStatement(formData: FormData) {
  const userId = await requireUserId();
  const file = formData.get("statementFile");

  if (!(file instanceof File) || file.size === 0) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Choose a bank statement file.")}`
    );
  }

  if (file.size > 2_000_000) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Statement file must be under 2MB.")}`
    );
  }

  const supabase = await createClient();
  const categories = await getCategories(supabase, userId);
  const text = await file.text().catch(async () => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return new TextDecoder("latin1").decode(bytes);
  });
  const rows = parseBankStatementText(text, categories);

  if (rows.length === 0) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("No transaction-like rows found after redaction.")}`
    );
  }

  const { data: importRow, error: importError } = await supabase
    .from("record_imports")
    .insert({
      user_id: userId,
      source_type: "bank_statement_pdf",
      original_filename: file.name || "bank-statement.pdf",
      status: "review",
      metadata: {
        row_count: rows.length,
        redaction_first: true,
        raw_statement_stored: false,
      },
    })
    .select("id")
    .single();

  if (importError || !importRow) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not create the bank statement import.")}`
    );
  }

  const { error: rowsError } = await supabase.from("bank_statement_import_rows").insert(
    rows.map((row) => ({
      user_id: userId,
      import_id: importRow.id,
      row_number: row.rowNumber,
      record_type: row.recordType,
      record_date: row.recordDate,
      description: row.description || null,
      amount: row.amountPence === null ? null : row.amountPence / 100,
      category_id: row.categoryId,
      status: row.errorMessage ? "invalid" : "review",
      error_message: row.errorMessage,
      redacted_line: row.redactedLine,
    }))
  );

  if (rowsError) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not stage bank statement rows.")}`
    );
  }

  revalidatePath("/dashboard/records");
  redirect(`/dashboard/records?bankImported=${rows.length}`);
}

export async function setBankStatementRowStatus(formData: FormData) {
  const userId = await requireUserId();
  const rowId = String(formData.get("rowId") ?? "");
  const status = String(formData.get("status") ?? "") === "discarded" ? "discarded" : "approved";

  if (!rowId) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Choose a bank statement row.")}`
    );
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("bank_statement_import_rows")
    .update({ status })
    .eq("id", rowId)
    .eq("user_id", userId)
    .in("status", ["review", "approved", "discarded"]);

  if (error) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not update the bank statement row.")}`
    );
  }

  revalidatePath("/dashboard/records");
  redirect("/dashboard/records?bankReviewed=1");
}

export async function commitApprovedBankRows() {
  const userId = await requireUserId();
  const supabase = await createClient();
  const { data: rows, error: rowsError } = await supabase
    .from("bank_statement_import_rows")
    .select("id, import_id, record_type, record_date, description, amount, category_id")
    .eq("user_id", userId)
    .eq("status", "approved")
    .not("record_date", "is", null)
    .not("description", "is", null)
    .not("amount", "is", null)
    .not("category_id", "is", null)
    .limit(100);

  if (rowsError || !rows || rows.length === 0) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Approve at least one valid bank row first.")}`
    );
  }

  const { data: inserted, error: insertError } = await supabase
    .from("financial_records")
    .insert(
      rows.map((row) => ({
        user_id: userId,
        record_type: row.record_type,
        record_date: row.record_date,
        description: row.description,
        amount: row.amount,
        category_id: row.category_id,
        import_id: row.import_id,
        source_type: "bank_statement_pdf",
        source_reference: `Bank statement row ${row.id}`,
        status: "approved",
        approved_at: new Date().toISOString(),
      }))
    )
    .select("id");

  if (insertError || !inserted) {
    redirect(
      `/dashboard/records?error=${encodeURIComponent("Could not commit approved bank rows.")}`
    );
  }

  for (let index = 0; index < rows.length; index += 1) {
    await supabase
      .from("bank_statement_import_rows")
      .update({
        status: "committed",
        committed_record_id: inserted[index]?.id ?? null,
      })
      .eq("id", rows[index].id)
      .eq("user_id", userId);
  }

  revalidatePath("/dashboard/records");
  redirect(`/dashboard/records?bankCommitted=${inserted.length}`);
}

function readRecordForm(formData: FormData) {
  return {
    recordType: String(formData.get("recordType") ?? ""),
    recordDate: String(formData.get("recordDate") ?? ""),
    description: String(formData.get("description") ?? ""),
    amount: String(formData.get("amount") ?? ""),
    categoryId: String(formData.get("categoryId") ?? ""),
    status: String(formData.get("status") ?? ""),
  };
}

async function getCategories(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
): Promise<CsvCategory[]> {
  const { data } = await supabase
    .from("record_categories")
    .select("id, name, record_type")
    .or(`user_id.eq.${userId},is_default.eq.true`);

  return (data ?? []) as CsvCategory[];
}

async function requireUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return user.id;
}

async function getOwnedCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  categoryId: string,
  recordType: RecordType
) {
  const { data } = await supabase
    .from("record_categories")
    .select("id")
    .eq("id", categoryId)
    .eq("record_type", recordType)
    .or(`user_id.eq.${userId},is_default.eq.true`)
    .maybeSingle();

  return data;
}
