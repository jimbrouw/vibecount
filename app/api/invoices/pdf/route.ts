import { isNativeGbpInvoice } from "@/lib/invoices/native";
import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createInvoicePdf } from "@/lib/invoices/pdf";
import { validateInvoiceInput } from "@/lib/invoices/validation";
import { normaliseClientName } from "@/lib/invoices/money";
import { invoiceEconomics } from "@/lib/invoices/economics";
import { invoiceDefaults, invoiceSellerReview } from "@/lib/settings-public";
import { inferDueDate, isValidEmail } from "@/lib/invoices/reminders";
import { loadPdfBranding } from "@/lib/pdf/settings-branding";

export const runtime = "nodejs";
type ClientRow = {
  id: string;
  name: string;
  email: string;
  address: string;
  company_number: string;
  vat_number: string;
};
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user)
    return NextResponse.json(
      { error: "Sign in to create an invoice." },
      { status: 401 },
    );
  const body = await request.json().catch(() => null);
  if (
    body?.humanConfirmed !== true ||
    typeof body?.revisionId !== "string" || typeof body?.invoiceId !== "string" ||
    !uuid.test(body?.revisionId ?? "") ||
    !uuid.test(body?.invoiceId ?? "")
  )
    return NextResponse.json(
      { error: "Confirm the invoice review before creating the PDF." },
      { status: 400 },
    );
  const parsed = validateInvoiceInput({
    clientName: String(body?.clientName ?? ""),
    invoiceDate: String(body?.invoiceDate ?? ""),
    description: String(body?.description ?? ""),
    amount: String(body?.amount ?? ""),
    paymentTerms: String(body?.paymentTerms ?? ""),
  });
  if (!parsed.ok)
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  if (typeof body.vatEnabled !== "boolean")
    return NextResponse.json(
      { error: "Review the VAT treatment." },
      { status: 400 },
    );
  const clientEmail = String(body.clientEmail ?? "").trim();
  if (clientEmail && !isValidEmail(clientEmail))
    return NextResponse.json(
      { error: "Use a valid client email address." },
      { status: 400 },
    );
  const { data: existing, error: invoiceError } = await supabase
    .from("invoices")
    .select(
      "id,number,status,finalised_at,updated_at,net_pence,vat_enabled,vat_rate_bps,vat_number_snapshot,origin,currency,amount",
    )
    .eq("id", body.invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (invoiceError)
    return NextResponse.json(
      { error: "Could not read the invoice." },
      { status: 503 },
    );
  if (existing && !isNativeGbpInvoice(existing)) return NextResponse.json({error:"Use the preserved invoice evidence workflow. Native PDF revision is unavailable for this invoice."},{status:409});
  const reviewHash = createHash("sha256")
    .update(
      JSON.stringify({
        invoice: body.invoiceId,
        expected: body.expectedUpdated ?? null,
        input: parsed.value,
        clientEmail,
        sellerReview: body.sellerReview,
        clientAddress: String(body.clientAddress ?? "").trim(),
        clientCompanyNumber: String(body.clientCompanyNumber ?? "").trim(),
        clientVatNumber: String(body.clientVatNumber ?? "").trim(),
        vatEnabled: body.vatEnabled,
        vatPence: body.vatPence,
        vatRate: body.vatRate,
        vatNumber: body.vatNumber,
        legacyConfirmed: body.legacyConfirmed === true,
        reason: String(body.reason ?? ""),
      }),
    )
    .digest("hex");
  const { data: prior, error: priorError } = await supabase
    .from("invoice_revisions")
    .select("invoice_id,origin,snapshot,pdf_path,pdf_sha256")
    .eq("id", body.revisionId)
    .eq("invoice_id", body.invoiceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (priorError)
    return NextResponse.json(
      {
        error: "Could not check invoice revision history. Check the migration.",
      },
      { status: 503 },
    );

  if (prior) {
    if (prior.origin !== "native_gbp" || String(prior.invoice_id).toLowerCase() !== body.invoiceId.toLowerCase() || prior.snapshot?.currency !== "GBP" || prior.snapshot?.review_hash !== reviewHash)
      return NextResponse.json(
        { error: "Invoice request changed. Review again." },
        { status: 409 },
      );
    const { data: stored, error } = await supabase.storage
      .from("invoices")
      .download(prior.pdf_path);
    if (error || !stored)
      return NextResponse.json(
        { error: "Could not recover the preserved invoice PDF." },
        { status: 503 },
      );
    const bytes = Buffer.from(await stored.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== prior.pdf_sha256)
      return NextResponse.json(
        { error: "Stored invoice evidence needs review." },
        { status: 503 },
      );
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${prior.snapshot.number}.pdf"`,
        "X-Invoice-Id": body.invoiceId,
        "X-Invoice-Number": prior.snapshot.number,
        "X-Invoice-Due-Date": prior.snapshot.due_date,
        "X-Invoice-Updated-At": prior.snapshot.confirmed_updated_at,
      },
    });
  }
  if (
    existing &&
    (!body.expectedUpdated ||
      String(existing.updated_at) !== body.expectedUpdated)
  )
    return NextResponse.json(
      { error: "Invoice changed. Reload and review." },
      { status: 409 },
    );
  if (existing && !String(body.reason ?? "").trim())
    return NextResponse.json(
      { error: "Explain this invoice revision." },
      { status: 400 },
    );
  if (existing) {
    const { data: credits, error: creditError } = await supabase
      .from("invoice_credit_notes")
      .select("id")
      .eq("invoice_id", existing.id)
      .eq("user_id", user.id)
      .limit(1);
    if (creditError)
      return NextResponse.json(
        { error: "Could not check invoice credit history." },
        { status: 503 },
      );
    if (credits?.length)
      return NextResponse.json(
        {
          error: "Invoices with credit history require a reviewed correction.",
        },
        { status: 409 },
      );
    const { data: settlements, error: settlementError } = await supabase
      .from("invoice_settlements")
      .select("id")
      .eq("invoice_id", existing.id)
      .eq("user_id", user.id)
      .limit(1);
    if (settlementError)
      return NextResponse.json(
        { error: "Could not check invoice settlement history." },
        { status: 503 },
      );
    if (settlements?.length)
      return NextResponse.json(
        {
          error:
            "Invoices with settlement history require a reviewed correction.",
        },
        { status: 409 },
      );
  }
  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select(
      "legal_name,address,contact_details,bank_details,payment_link_provider,payment_link_url,vat_registered,vat_number,vat_rate,invoice_number_prefix,late_payment_wording,pdf_logo_path,pdf_primary_color,pdf_accent_color",
    )
    .eq("id", user.id)
    .maybeSingle();
  if (settingsError)
    return NextResponse.json(
      { error: "Could not read invoice settings." },
      { status: 503 },
    );
  if (
    JSON.stringify(body.sellerReview) !==
    JSON.stringify(invoiceSellerReview(invoiceDefaults(settings)))
  )
    return NextResponse.json(
      {
        error:
          "Business or payment details changed. Reload and review the invoice again.",
      },
      { status: 409 },
    );
  // Saved economics prevail over mutable defaults. Legacy breakdowns are explicit user input.
  let rate: unknown = settings?.vat_rate ?? 20;
  let vatNumber = settings?.vat_number ?? "";
  if (existing?.net_pence !== null && existing?.net_pence !== undefined) {
    if (body.vatEnabled !== existing.vat_enabled)
      return NextResponse.json(
        {
          error:
            "Preserve the saved VAT treatment. Use a reviewed correction to change it.",
        },
        { status: 409 },
      );
    rate = existing.vat_rate_bps / 100;
    vatNumber = existing.vat_number_snapshot ?? "";
  } else if (
    existing &&
    (existing.status === "finalised" || existing.finalised_at)
  ) {
    if (body.legacyConfirmed !== true)
      return NextResponse.json(
        { error: "Check the original invoice and confirm its VAT breakdown." },
        { status: 400 },
      );
    rate = body.vatRate;
    vatNumber = String(body.vatNumber ?? "");
  } else if (body.vatEnabled && !settings?.vat_registered) {
    return NextResponse.json(
      { error: "Check your VAT registration settings." },
      { status: 400 },
    );
  }
  let economics;
  try {
    economics = invoiceEconomics(
      parsed.value.amountPence,
      body.vatEnabled,
      rate,
      vatNumber,
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Check the invoice amounts.",
      },
      { status: 400 },
    );
  }
  if (
    body.vatPence !== economics.vatPence ||
    body.vatRate !== String(economics.vatRateBps / 100) ||
    body.vatNumber !== economics.vatNumber
  )
    return NextResponse.json(
      { error: "VAT details changed. Reload and review the invoice again." },
      { status: 409 },
    );
  const client = await findOrCreateClient(
    supabase,
    user.id,
    parsed.value.clientName,
    clientEmail,
    {
      address: String(body.clientAddress ?? "").trim(),
      company_number: String(body.clientCompanyNumber ?? "").trim(),
      vat_number: String(body.clientVatNumber ?? "").trim(),
    },
  );
  if (!client.ok)
    return NextResponse.json({ error: client.error }, { status: 500 });
  const dueDate = inferDueDate(
    parsed.value.invoiceDate,
    parsed.value.paymentTerms,
  );
  const prefix = settings?.invoice_number_prefix?.trim() || "VC";
  {
    const number =
      existing?.number ??
      (await nextInvoiceNumber(supabase, user.id, prefix, 0));
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(number))
      return NextResponse.json(
        {
          error:
            "Use letters, digits, hyphens or underscores in the invoice prefix.",
        },
        { status: 400 },
      );
    const pdfData = {
      number,
      invoiceDate: parsed.value.invoiceDate,
      clientName: client.value.name,
      clientAddress: client.value.address,
      clientVatNumber: economics.vatEnabled ? client.value.vat_number : "",
      description: parsed.value.description,
      amountPence: economics.netPence,
      vatPence: economics.vatPence,
      paymentTerms: parsed.value.paymentTerms,
      freelancerEmail: user.email ?? "",
      freelancerName: settings?.legal_name ?? "",
      freelancerAddress: settings?.address ?? "",
      freelancerContact: settings?.contact_details ?? "",
      bankDetails: settings?.bank_details ?? "",
      paymentLinkProvider: settings?.payment_link_provider ?? "",
      paymentLinkUrl: settings?.payment_link_url ?? "",
      vatNumber: economics.vatNumber,
      vatRate: economics.vatRateBps / 100,
      latePaymentWording: settings?.late_payment_wording ?? "",
      branding: await loadPdfBranding(supabase, settings),
    };
    const data = {
      number,
      client_id: client.value.id,
      client_snapshot: client.value,
      invoice_date: parsed.value.invoiceDate,
      due_date: dueDate,
      description: parsed.value.description,
      payment_terms: parsed.value.paymentTerms,
      net_pence: economics.netPence,
      vat_pence: economics.vatPence,
      vat_rate_bps: economics.vatRateBps,
      vat_enabled: economics.vatEnabled,
      vat_number: economics.vatNumber,
      pdf: {
        ...pdfData,
        branding: {
          primaryColor: pdfData.branding.primaryColor,
          accentColor: pdfData.branding.accentColor,
          logoSha256: pdfData.branding.logoBytes
            ? createHash("sha256")
                .update(pdfData.branding.logoBytes)
                .digest("hex")
            : null,
        },
      },
      reason: String(body.reason ?? ""),
      legacy_confirmed: body.legacyConfirmed === true,
      review_hash: reviewHash,
    };
    const path = `${user.id}/revisions/${body.revisionId}.pdf`;
    const pdfBytes = await createInvoicePdf(pdfData);
    const sha = createHash("sha256").update(pdfBytes).digest("hex");
    const { error: uploadError } = await supabase.storage
      .from("invoices")
      .upload(path, Buffer.from(pdfBytes), {
        contentType: "application/pdf",
        upsert: false,
      });
    if (uploadError)
      return NextResponse.json(
        {
          error:
            "Could not preserve the reviewed PDF. Reload before retrying; the previous confirmed invoice is unchanged.",
        },
        { status: 503 },
      );

    const { data: saved, error } = await supabase.rpc("save_invoice_revision", {
      p_invoice: body.invoiceId,
      p_revision: body.revisionId,
      p_expected_updated: body.expectedUpdated ?? null,
      p_data: data,
      p_pdf_path: path,
      p_pdf_sha256: sha,
    });
    if (error) {
      // Number collisions require a fresh revision path; retain this unused upload for recovery.
      return NextResponse.json(
        {
          error:
            "The invoice could not be confirmed. Reload and review it; the preserved upload is retained for recovery.",
        },
        {
          status: error.code === "23505" || error.code === "P0001" ? 409 : 503,
        },
      );
    }
    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${number}.pdf"`,
        "X-Invoice-Id": saved.id,
        "X-Invoice-Number": number,
        "X-Invoice-Due-Date": dueDate,
        "X-Invoice-Updated-At": saved.updated_at ?? "",
      },
    });
  }
}

async function findOrCreateClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientName: string,
  clientEmail: string,
  details: { address: string; company_number: string; vat_number: string } = {
    address: "",
    company_number: "",
    vat_number: "",
  },
): Promise<{ ok: true; value: ClientRow } | { ok: false; error: string }> {
  const normalised = normaliseClientName(clientName);
  const { data: clients, error: readError } = await supabase
    .from("clients")
    .select("id, name, email, address, company_number, vat_number")
    .eq("user_id", userId);

  if (readError) {
    return { ok: false, error: "Could not check saved clients." };
  }

  const existing = (clients as ClientRow[] | null)?.find(
    (client) =>
      normaliseClientName(client.name).toLowerCase() ===
      normalised.toLowerCase(),
  );

  if (existing)
    return {
      ok: true,
      value: {
        ...existing,
        email: clientEmail || existing.email,
        address: details.address || existing.address,
        company_number: details.company_number || existing.company_number,
        vat_number: details.vat_number || existing.vat_number,
      },
    };

  const { data: inserted, error: insertError } = await supabase
    .from("clients")
    .insert({
      user_id: userId,
      name: normalised,
      email: clientEmail,
      address: details.address,
      company_number: details.company_number,
      vat_number: details.vat_number,
    })
    .select("id, name, email, address, company_number, vat_number")
    .single();

  if (!insertError && inserted) {
    return { ok: true, value: inserted as ClientRow };
  }

  if (insertError?.code === "23505") {
    const { data: retryClients } = await supabase
      .from("clients")
      .select("id, name, email, address, company_number, vat_number")
      .eq("user_id", userId);
    const retry = (retryClients as ClientRow[] | null)?.find(
      (client) =>
        normaliseClientName(client.name).toLowerCase() ===
        normalised.toLowerCase(),
    );
    if (retry) {
      return { ok: true, value: retry };
    }
  }

  return { ok: false, error: "Could not save the client." };
}

async function nextInvoiceNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  prefix: string,
  offset: number,
) {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return `${prefix}-${year}-${String((count ?? 0) + 1 + offset).padStart(4, "0")}`;
}
