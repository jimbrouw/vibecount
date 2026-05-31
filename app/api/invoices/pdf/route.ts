import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createInvoicePdf } from "@/lib/invoices/pdf";
import { validateInvoiceInput } from "@/lib/invoices/validation";
import { normaliseClientName } from "@/lib/invoices/money";
import { inferDueDate, isValidEmail } from "@/lib/invoices/reminders";

export const runtime = "nodejs";

type ClientRow = {
  id: string;
  name: string;
  email: string;
  address: string;
  company_number: string;
  vat_number: string;
};

type InvoiceRow = {
  id: string;
  number: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ error: "Sign in to create an invoice." }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (body?.humanConfirmed !== true) {
    return NextResponse.json(
      { error: "Confirm the invoice review before creating the PDF." },
      { status: 400 }
    );
  }

  const parsed = validateInvoiceInput({
    clientName: String(body?.clientName ?? ""),
    invoiceDate: String(body?.invoiceDate ?? ""),
    description: String(body?.description ?? ""),
    amount: String(body?.amount ?? ""),
    paymentTerms: String(body?.paymentTerms ?? ""),
  });

  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const vatPence = typeof body?.vatPence === "number" ? Math.round(body.vatPence) : 0;
  const clientEmail = String(body?.clientEmail ?? "").trim();
  const clientAddress = String(body?.clientAddress ?? "").trim();
  const clientCompanyNumber = String(body?.clientCompanyNumber ?? "").trim();
  const clientVatNumber = String(body?.clientVatNumber ?? "").trim();
  if (clientEmail && !isValidEmail(clientEmail)) {
    return NextResponse.json({ error: "Use a valid client email address." }, { status: 400 });
  }

  const input = parsed.value;
  const dueDate = inferDueDate(input.invoiceDate, input.paymentTerms);

  // Load user settings for PDF personalisation
  const { data: settings } = await supabase
    .from("user_settings")
    .select(
      "legal_name, address, contact_details, bank_details, payment_link_provider, payment_link_url, vat_registered, vat_number, vat_rate, invoice_number_prefix, late_payment_wording"
    )
    .eq("id", user.id)
    .maybeSingle();

  const client = await findOrCreateClient(supabase, user.id, input.clientName, clientEmail, {
    address: clientAddress,
    company_number: clientCompanyNumber,
    vat_number: clientVatNumber,
  });
  if (!client.ok) {
    return NextResponse.json({ error: client.error }, { status: 500 });
  }

  const prefix = settings?.invoice_number_prefix?.trim() || "VC";

  const invoice = await createFinalInvoice(supabase, user.id, client.value.id, prefix, {
    invoiceDate: input.invoiceDate,
    dueDate,
    description: input.description,
    amountPence: input.amountPence + vatPence,
    paymentTerms: input.paymentTerms,
  });

  if (!invoice.ok) {
    return NextResponse.json({ error: invoice.error }, { status: 500 });
  }

  const pdfBytes = await createInvoicePdf({
    number: invoice.value.number,
    invoiceDate: input.invoiceDate,
    clientName: client.value.name,
    clientAddress: client.value.address,
    clientVatNumber: settings?.vat_registered ? client.value.vat_number : "",
    description: input.description,
    amountPence: input.amountPence,
    vatPence,
    paymentTerms: input.paymentTerms,
    freelancerEmail: user.email ?? "",
    freelancerName: settings?.legal_name ?? "",
    freelancerAddress: settings?.address ?? "",
    freelancerContact: settings?.contact_details ?? "",
    bankDetails: settings?.bank_details ?? "",
    paymentLinkProvider: settings?.payment_link_provider ?? "",
    paymentLinkUrl: settings?.payment_link_url ?? "",
    vatNumber: settings?.vat_number ?? "",
    vatRate: settings?.vat_rate ?? null,
    latePaymentWording: settings?.late_payment_wording ?? "",
  });

  const filename = `${invoice.value.number}.pdf`;

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Invoice-Id": invoice.value.id,
      "X-Invoice-Number": invoice.value.number,
      "X-Invoice-Due-Date": dueDate,
    },
  });
}

async function findOrCreateClient(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientName: string,
  clientEmail: string,
  details: { address: string; company_number: string; vat_number: string } = { address: "", company_number: "", vat_number: "" }
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
    (client) => normaliseClientName(client.name).toLowerCase() === normalised.toLowerCase()
  );

  if (existing) {
    const updates: Partial<ClientRow> = {};
    if (clientEmail && existing.email !== clientEmail) updates.email = clientEmail;
    if (details.address && !existing.address) updates.address = details.address;
    if (details.company_number && !existing.company_number) updates.company_number = details.company_number;
    if (details.vat_number && !existing.vat_number) updates.vat_number = details.vat_number;

    if (Object.keys(updates).length > 0) {
      await supabase.from("clients").update(updates).eq("id", existing.id).eq("user_id", userId);
    }
    return { ok: true, value: { ...existing, ...updates } };
  }

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
        normaliseClientName(client.name).toLowerCase() === normalised.toLowerCase()
    );
    if (retry) {
      return { ok: true, value: retry };
    }
  }

  return { ok: false, error: "Could not save the client." };
}

async function createFinalInvoice(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  clientId: string,
  prefix: string,
    input: {
    invoiceDate: string;
    dueDate: string;
    description: string;
    amountPence: number;
    paymentTerms: string;
  }
): Promise<{ ok: true; value: InvoiceRow } | { ok: false; error: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const number = await nextInvoiceNumber(supabase, userId, prefix, attempt);
    const { data, error } = await supabase
      .from("invoices")
      .insert({
        user_id: userId,
        client_id: clientId,
        number,
        invoice_date: input.invoiceDate,
        due_date: input.dueDate,
        description: input.description,
        amount: input.amountPence / 100,
        payment_terms: input.paymentTerms,
        status: "finalised",
        finalised_at: new Date().toISOString(),
      })
      .select("id, number")
      .single();

    if (!error && data) {
      return { ok: true, value: data as InvoiceRow };
    }

    if (error?.code !== "23505") {
      return { ok: false, error: "Could not save the invoice." };
    }
  }

  return { ok: false, error: "Could not choose a unique invoice number." };
}

async function nextInvoiceNumber(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  prefix: string,
  offset: number
) {
  const year = new Date().getFullYear();
  const { count } = await supabase
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  return `${prefix}-${year}-${String((count ?? 0) + 1 + offset).padStart(4, "0")}`;
}
