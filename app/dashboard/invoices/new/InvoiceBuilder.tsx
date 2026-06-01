"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { amountToWords, formatPounds, parseAmountToPence } from "@/lib/invoices/money";
import type { UserSettings } from "@/lib/settings";
import { buildInvoiceEmailDraft } from "@/lib/invoices/reminders";
import {
  DEFAULT_PAYMENT_TERMS,
  parseInvoiceDateToIso,
} from "@/lib/invoices/validation";
import { trackEvent } from "@/lib/analytics";
import { useAccessibility } from "@/app/dashboard/AccessibilityProvider";
import ExplainTerm from "@/app/dashboard/ExplainTerm";
import ReadAloudButton from "@/app/dashboard/ReadAloudButton";
import {
  enableInvoiceReminders,
  markInvoiceSent,
} from "@/app/dashboard/invoices/actions";

type ClientOption = {
  id: string;
  name: string;
  email: string;
  address: string;
  company_number: string;
  vat_number: string;
};

type CHSuggestion = {
  name: string;
  company_number: string;
  address: string;
};

type UserDefaults = UserSettings & {
  hasSettings: boolean;
  companiesHouseConfigured: boolean;
};

type Props = {
  existingClients: ClientOption[];
  initialDate: string;
  userDefaults: UserDefaults;
  initialDraft: {
    clientName: string;
    description: string;
    amount: string;
    source: string;
    transcript: string;
    clientAddress: string;
    clientCompanyNumber: string;
  };
};

type FormState = {
  clientName: string;
  clientEmail: string;
  clientAddress: string;
  clientCompanyNumber: string;
  clientVatNumber: string;
  invoiceDate: string;
  description: string;
  amount: string;
  paymentTerms: string;
  vatEnabled: boolean;
};

type GeneratedInvoice = {
  id: string;
  number: string;
  dueDate: string;
  subject: string;
  body: string;
};

export default function InvoiceBuilder({
  existingClients,
  initialDate,
  userDefaults,
  initialDraft,
}: Props) {
  const { plainLanguage } = useAccessibility();
  const [form, setForm] = useState<FormState>({
    clientName: initialDraft.clientName,
    clientEmail: "",
    clientAddress: initialDraft.clientAddress,
    clientCompanyNumber: initialDraft.clientCompanyNumber,
    clientVatNumber: "",
    invoiceDate: initialDate,
    description: initialDraft.description,
    amount: initialDraft.amount,
    paymentTerms: userDefaults.default_payment_terms || DEFAULT_PAYMENT_TERMS,
    vatEnabled: userDefaults.vat_registered,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [lastInvoice, setLastInvoice] = useState("");
  const [generatedInvoice, setGeneratedInvoice] = useState<GeneratedInvoice | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const hasTrackedManualEntry = useRef(false);
  const [chSuggestions, setChSuggestions] = useState<CHSuggestion[]>([]);
  const [showChDropdown, setShowChDropdown] = useState(false);
  const chTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const amountPence = useMemo(() => parseAmountToPence(form.amount), [form.amount]);
  const vatPence = useMemo(() => {
    if (!form.vatEnabled || amountPence === null) return 0;
    return Math.round(amountPence * (userDefaults.vat_rate / 100));
  }, [form.vatEnabled, amountPence, userDefaults.vat_rate]);
  const totalPence = amountPence !== null ? amountPence + vatPence : null;

  const amountFigure = amountPence === null ? "£0.00" : formatPounds(amountPence);
  const totalFigure = totalPence === null ? "£0.00" : formatPounds(totalPence);
  const amountWords =
    totalPence === null
      ? "enter an amount to see it in words"
      : amountToWords(totalPence);
  const amountReadAloudText = useMemo(() => {
    if (totalPence === null) {
      return "No amount entered yet.";
    }

    const vatSummary =
      form.vatEnabled && vatPence > 0
        ? ` This includes ${formatPounds(vatPence)} of VAT.`
        : "";
    return `Total amount ${totalFigure}. In words, ${amountWords}.${vatSummary}`;
  }, [amountWords, form.vatEnabled, totalFigure, totalPence, vatPence]);
  const summaryReadAloudText = useMemo(() => {
    const parts = [
      `Invoice date ${formatPreviewDate(form.invoiceDate)}.`,
      `From ${userDefaults.legal_name || "your saved business details"}.`,
      `To ${form.clientName.trim() || "client name not added yet"}.`,
      `Work summary ${form.description.trim() || "description not added yet"}.`,
      `Total ${totalFigure}. In words, ${amountWords}.`,
      `Payment terms ${form.paymentTerms.trim() || DEFAULT_PAYMENT_TERMS}.`,
    ];

    if (userDefaults.bank_details) {
      parts.push(`Payment details ${userDefaults.bank_details}.`);
    }
    if (userDefaults.payment_link_url) {
      parts.push(`Online payment link ${userDefaults.payment_link_url}.`);
    }

    return parts.join(" ");
  }, [
    amountWords,
    form.clientName,
    form.description,
    form.invoiceDate,
    form.paymentTerms,
    totalFigure,
    userDefaults.bank_details,
    userDefaults.legal_name,
    userDefaults.payment_link_url,
  ]);

  useEffect(() => {
    if (initialDraft.source === "voice" || hasTrackedManualEntry.current) {
      return;
    }

    hasTrackedManualEntry.current = true;
    trackEvent("manual_entry_usage", { source: "typed_invoice_page" });
  }, [initialDraft.source]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    setLastInvoice("");
    setGeneratedInvoice(null);
    setCopyStatus("");

    const response = await fetch("/api/invoices/pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        vatPence,
        humanConfirmed: true,
        clientAddress: form.clientAddress,
        clientCompanyNumber: form.clientCompanyNumber,
        clientVatNumber: form.clientVatNumber,
      }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => null);
      setError(body?.error ?? "Could not create the PDF.");
      setIsSubmitting(false);
      return;
    }

    const blob = await response.blob();
    const invoiceId = response.headers.get("X-Invoice-Id") ?? "";
    const invoiceNumber = response.headers.get("X-Invoice-Number") ?? "invoice";
    const dueDate = response.headers.get("X-Invoice-Due-Date") ?? "";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${invoiceNumber}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setLastInvoice(invoiceNumber);
    setGeneratedInvoice({
      id: invoiceId,
      number: invoiceNumber,
      dueDate,
      ...buildInvoiceEmailDraft({
        invoiceNumber,
        clientName: form.clientName.trim(),
        amountPence: totalPence ?? 0,
        dueDate,
        paymentTerms: form.paymentTerms.trim() || DEFAULT_PAYMENT_TERMS,
        paymentLinkUrl: userDefaults.payment_link_url,
        senderName: userDefaults.legal_name,
      }),
    });
    trackEvent("pdf_invoices_generated", {
      source: initialDraft.source === "voice" ? "voice_to_typed" : "typed",
      vat_enabled: form.vatEnabled,
    });
    setIsSubmitting(false);
  }

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleClientNameChange(value: string) {
    updateField("clientName", value);

    // Pre-fill from saved clients
    const saved = existingClients.find(
      (c) => c.name.toLowerCase().trim() === value.toLowerCase().trim()
    );
    if (saved) {
      setForm((f) => ({
        ...f,
        clientName: value,
        clientEmail: f.clientEmail || saved.email,
        clientAddress: f.clientAddress || saved.address,
        clientCompanyNumber: f.clientCompanyNumber || saved.company_number,
        clientVatNumber: f.clientVatNumber || saved.vat_number,
      }));
      setShowChDropdown(false);
      return;
    }

    // Companies House search (debounced)
    if (!userDefaults.companiesHouseConfigured || value.length < 2) {
      setChSuggestions([]);
      setShowChDropdown(false);
      return;
    }
    if (chTimer.current) clearTimeout(chTimer.current);
    chTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies-house/search?q=${encodeURIComponent(value)}`);
        const data = await res.json() as { companies?: CHSuggestion[] };
        setChSuggestions(data.companies ?? []);
        setShowChDropdown((data.companies?.length ?? 0) > 0);
      } catch {
        setChSuggestions([]);
      }
    }, 400);
  }

  function selectChSuggestion(company: CHSuggestion) {
    setForm((f) => ({
      ...f,
      clientName: company.name,
      clientAddress: company.address,
      clientCompanyNumber: company.company_number,
    }));
    setShowChDropdown(false);
    setChSuggestions([]);
  }

  async function copyEmailDraft() {
    if (!generatedInvoice) return;
    const text = `Subject: ${generatedInvoice.subject}\n\n${generatedInvoice.body}`;
    await navigator.clipboard.writeText(text);
    setCopyStatus("Copied");
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-5 py-6 sm:px-8 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#e5e0d8] sm:p-6">
        <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#1a3a2a]">
              Create an invoice
            </h1>
            <p className="mt-1 text-sm leading-6 text-[#4a6a5a]">
              Add the details, check the preview, then download the PDF.
            </p>
            <div className="mt-3">
              <Link
                href="/dashboard/invoices/voice"
                data-testid="invoice-switch-to-voice-link"
                className="text-sm font-medium text-[#1a3a2a] underline decoration-[#9bb49f] underline-offset-4"
              >
                Prefer to speak it instead?
              </Link>
            </div>
          </div>
          <a
            href="#invoice-preview"
            className="text-sm font-medium text-[#1a3a2a] underline decoration-[#9bb49f] underline-offset-4 lg:hidden"
          >
            Preview
          </a>
        </div>

        {/* Onboarding nudge */}
        {!userDefaults.hasSettings && (
          <div className="mb-5 flex items-center gap-3 rounded-lg border border-[#c8dfc8] bg-[#eef6ef] px-4 py-3">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="flex-shrink-0 text-[#2d6a4a]"
            >
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <line
                x1="8"
                y1="5"
                x2="8"
                y2="8.5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
              <circle cx="8" cy="11" r="0.75" fill="currentColor" />
            </svg>
            <p className="text-xs text-[#1a3a2a]">
              Add your trading name and bank details in{" "}
              <Link
                href="/dashboard/settings"
                data-testid="invoice-settings-link"
                className="font-semibold underline decoration-[#9bb49f] underline-offset-2"
              >
                Settings
              </Link>{" "}
              for a complete PDF.
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5" data-testid="invoice-form">
          {plainLanguage ? (
            <p className="plain-language-note">
              Fill in who the invoice is for, what the work was, and how much to
              charge. The app will show the total in numbers and words before you download.
            </p>
          ) : null}

          {initialDraft.source === "voice" ? (
            <div className="rounded-lg border border-[#c8dfc8] bg-[#f0f8f0] px-4 py-3 text-sm text-[#1a3a2a]">
              Voice draft loaded into the normal invoice preview. Check every field before
              you download the PDF.
            </div>
          ) : null}

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-[#1a3a2a]">Client</span>
              <div className="relative">
                <input
                  name="clientName"
                  data-testid="invoice-client-input"
                  list="saved-clients"
                  value={form.clientName}
                  onChange={(event) => handleClientNameChange(event.target.value)}
                  onBlur={() => setTimeout(() => setShowChDropdown(false), 200)}
                  onFocus={() => chSuggestions.length > 0 && setShowChDropdown(true)}
                  required
                  className={inputCls}
                  placeholder="Client or company name"
                  autoComplete="off"
                />
                <datalist id="saved-clients">
                  {existingClients.map((client) => (
                    <option key={client.id} value={client.name} />
                  ))}
                </datalist>
                {showChDropdown && chSuggestions.length > 0 && (
                  <ul className="absolute z-20 mt-1 w-full rounded-xl border border-[#c8dfc8] bg-white shadow-lg">
                    {chSuggestions.map((company) => (
                      <li key={company.company_number}>
                        <button
                          type="button"
                          onMouseDown={() => selectChSuggestion(company)}
                          className="w-full px-4 py-2.5 text-left transition hover:bg-[#f0f8f0]"
                        >
                          <p className="text-sm font-semibold text-[#1a3a2a]">{company.name}</p>
                          <p className="text-xs text-[#4a6a5a]">{company.company_number} · {company.address}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {form.clientAddress && (
                <p className="mt-1 text-xs text-[#4a6a5a]">{form.clientAddress}</p>
              )}
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[#1a3a2a]">
                Client email
              </span>
              <input
                name="clientEmail"
                data-testid="invoice-client-email-input"
                type="email"
                value={form.clientEmail}
                onChange={(event) => updateField("clientEmail", event.target.value)}
                className={inputCls}
                placeholder="client@example.com"
              />
              {plainLanguage ? (
                <p className="mt-2 text-xs text-[#4a6a5a]">
                  Used only when you choose to prepare reminder drafts.
                </p>
              ) : null}
            </label>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-[#1a3a2a]">Invoice date</span>
              <input
                name="invoiceDate"
                data-testid="invoice-date-input"
                type="text"
                inputMode="numeric"
                value={form.invoiceDate}
                onChange={(event) => updateField("invoiceDate", event.target.value)}
                required
                className={inputCls}
                placeholder="26/05/2026"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium text-[#1a3a2a]">What is this for?</span>
            <textarea
              name="description"
              data-testid="invoice-description-input"
              value={form.description}
              onChange={(event) => updateField("description", event.target.value)}
              required
              rows={4}
              className="mt-2 w-full resize-y rounded-lg border border-[#d5d0c8] bg-white px-3 py-3 text-base leading-6 text-[#1a3a2a] outline-none transition focus:border-[#2d6a4a] focus:ring-2 focus:ring-[#b9d2bd]"
              placeholder="Projection mapping for the museum install"
            />
          </label>

          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="text-sm font-medium text-[#1a3a2a]">Amount (excl. VAT)</span>
              <div className="mt-2 flex h-12 overflow-hidden rounded-lg border border-[#d5d0c8] bg-white focus-within:border-[#2d6a4a] focus-within:ring-2 focus-within:ring-[#b9d2bd]">
                <span className="flex w-11 items-center justify-center border-r border-[#e5e0d8] bg-[#f8f5ef] text-[#4a6a5a]">
                  £
                </span>
                <input
                  name="amount"
                  data-testid="invoice-amount-input"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(event) => updateField("amount", event.target.value)}
                  required
                  className="min-w-0 flex-1 px-3 text-base text-[#1a3a2a] outline-none"
                  placeholder="850.00"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-sm font-medium text-[#1a3a2a]">
                Payment terms
              </span>
              <input
                name="paymentTerms"
                data-testid="invoice-payment-terms-input"
                value={form.paymentTerms}
                onChange={(event) => updateField("paymentTerms", event.target.value)}
                className={inputCls}
              />
              {plainLanguage ? (
                <p className="mt-2 text-xs text-[#4a6a5a]">
                  This tells the client when you expect to be paid.
                </p>
              ) : null}
            </label>
          </div>

          {/* VAT toggle (only if VAT registered in settings) */}
          {userDefaults.vat_registered && (
            <div className="flex items-center gap-3 rounded-lg border border-[#d5d0c8] bg-[#f8f5ef] px-4 py-3">
              <label className="flex cursor-pointer items-center gap-3">
                <div className="relative">
                  <input
                    type="checkbox"
                    data-testid="invoice-vat-toggle"
                    checked={form.vatEnabled}
                    onChange={(e) => updateField("vatEnabled", e.target.checked)}
                    className="sr-only"
                    id="vat-toggle"
                  />
                  <div
                    className={`h-5 w-9 rounded-full transition-colors duration-200 ${
                      form.vatEnabled ? "bg-[#2d6a4a]" : "bg-[#d5d0c8]"
                    }`}
                  />
                  <div
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${
                      form.vatEnabled ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </div>
                <span className="text-sm text-[#1a3a2a]">
                  Add{" "}
                  <ExplainTerm term="Value Added Tax (VAT)">VAT</ExplainTerm>{" "}
                  ({userDefaults.vat_rate}%)
                </span>
              </label>
              {form.vatEnabled && amountPence !== null && (
                <span className="ml-auto text-sm text-[#4a6a5a]">
                  +{formatPounds(vatPence)}
                </span>
              )}
            </div>
          )}

          {/* Amount check */}
          <div className="rounded-lg border border-[#d7d1c3] bg-[#f6f2ea] p-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-[#1a3a2a]">Amount check</p>
              <ReadAloudButton text={amountReadAloudText} label="amount summary" />
            </div>
            <p className="mt-2 text-2xl font-semibold text-[#1a3a2a]">{totalFigure}</p>
            {form.vatEnabled && amountPence !== null && (
              <p className="mt-0.5 text-xs text-[#7a9a87]">
                {amountFigure} + {formatPounds(vatPence)} VAT
              </p>
            )}
            <p className="mt-1 text-sm leading-6 text-[#4a6a5a]">{amountWords}</p>
          </div>

          {error ? (
            <p className="rounded-lg border border-[#e0b4a7] bg-[#fff7f3] px-4 py-3 text-sm text-[#7a271a]">
              {error}
            </p>
          ) : null}

          {lastInvoice ? (
            <p className="rounded-lg border border-[#b9d2bd] bg-[#f1f8f2] px-4 py-3 text-sm text-[#1a3a2a]">
              {lastInvoice} downloaded. Check the PDF before sending it.
            </p>
          ) : null}

          <button
            type="submit"
            data-testid="invoice-confirm-download-button"
            disabled={isSubmitting}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#1a3a2a] px-5 text-sm font-semibold text-white transition hover:bg-[#2d6a4a] disabled:cursor-not-allowed disabled:bg-[#8a9a91] sm:w-auto"
          >
            {isSubmitting ? "Creating PDF…" : "Confirm and download PDF"}
          </button>
        </form>

        {generatedInvoice ? (
          <section className="mt-6 rounded-xl border border-[#b9d2bd] bg-[#f1f8f2] p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-[#1a3a2a]">
                  Email draft for {generatedInvoice.number}
                </p>
                <p className="mt-1 text-xs leading-5 text-[#4a6a5a]">
                  Send this from your own email app, then mark the invoice as sent.
                </p>
              </div>
              <button
                type="button"
                data-testid="invoice-copy-email-button"
                onClick={copyEmailDraft}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[#b9d2bd] bg-white px-4 text-sm font-semibold text-[#1a3a2a] transition hover:bg-[#eef6ef]"
              >
                {copyStatus || "Copy email"}
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-[#d7d1c3] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                Subject
              </p>
              <p className="mt-1 text-sm text-[#1a3a2a]">{generatedInvoice.subject}</p>
              <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                Body
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#1a3a2a]">
                {generatedInvoice.body}
              </p>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <form action={markInvoiceSent} className="space-y-3" data-testid="invoice-mark-sent-form">
                <input type="hidden" name="invoiceId" value={generatedInvoice.id} />
                <input type="hidden" name="clientEmail" value={form.clientEmail} />
                <input type="hidden" name="redirectTo" value="/dashboard" />
                <button
                  type="submit"
                  data-testid="invoice-mark-sent-button"
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#1a3a2a] px-4 text-sm font-semibold text-white transition hover:bg-[#2d6a4a]"
                >
                  I’ve sent this invoice
                </button>
              </form>

              <form action={enableInvoiceReminders} className="space-y-3" data-testid="invoice-enable-reminders-form">
                <input type="hidden" name="invoiceId" value={generatedInvoice.id} />
                <input type="hidden" name="clientEmail" value={form.clientEmail} />
                <input type="hidden" name="redirectTo" value="/dashboard" />
                <button
                  type="submit"
                  data-testid="invoice-enable-reminders-button"
                  className="inline-flex h-11 w-full items-center justify-center rounded-xl border border-[#b9d2bd] bg-white px-4 text-sm font-semibold text-[#1a3a2a] transition hover:bg-[#eef6ef]"
                >
                  Prepare reminder drafts
                </button>
              </form>
            </div>
          </section>
        ) : null}
      </section>

      <aside
        id="invoice-preview"
        data-testid="invoice-preview"
        className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-[#e5e0d8] sm:p-6 lg:sticky lg:top-6 lg:self-start"
      >
        <p className="text-sm font-medium uppercase tracking-[0.12em] text-[#4a6a5a]">
          Preview
        </p>
        <div className="mt-5 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight text-[#1a3a2a]">
                Invoice
              </h2>
              <p className="mt-1 text-sm text-[#4a6a5a]">Number generated on download</p>
            </div>
            <div className="text-right text-sm text-[#4a6a5a]">
              {formatPreviewDate(form.invoiceDate)}
            </div>
          </div>

          <ReadAloudButton text={summaryReadAloudText} label="invoice summary" />

          {plainLanguage ? (
            <p className="plain-language-note">
              This is the short version of what the PDF will say when you download it.
            </p>
          ) : null}

          {userDefaults.legal_name && (
            <div className="border-t border-[#e5e0d8] pt-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                From
              </p>
              <p className="mt-1.5 text-sm font-medium text-[#1a3a2a]">
                {userDefaults.legal_name}
              </p>
              {userDefaults.address ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#4a6a5a]">
                  {userDefaults.address}
                </p>
              ) : null}
              {userDefaults.contact_details ? (
                <p className="mt-1 text-sm leading-6 text-[#4a6a5a]">
                  {userDefaults.contact_details}
                </p>
              ) : null}
              {form.vatEnabled && userDefaults.vat_number ? (
                <p className="mt-1 text-sm leading-6 text-[#4a6a5a]">
                  VAT reg: {userDefaults.vat_number}
                </p>
              ) : null}
            </div>
          )}

          <div className={userDefaults.legal_name ? "" : "border-t border-[#e5e0d8] pt-4"}>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
              To
            </p>
            <p className="mt-1.5 text-lg font-medium text-[#1a3a2a]">
              {form.clientName.trim() || "Client name"}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
              Work
            </p>
            <p className="mt-1.5 min-h-12 whitespace-pre-wrap text-sm leading-6 text-[#1a3a2a]">
              {form.description.trim() || "Description appears here."}
            </p>
          </div>

          <div className="rounded-xl border border-[#d7d1c3] bg-[#f6f2ea] p-4">
            <p className="text-sm text-[#4a6a5a]">Total</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-[#1a3a2a]">
              {totalFigure}
            </p>
            {form.vatEnabled && amountPence !== null && (
              <p className="mt-1 text-xs text-[#7a9a87]">
                inc. {formatPounds(vatPence)} VAT ({userDefaults.vat_rate}%)
              </p>
            )}
            <p className="mt-2 text-sm leading-6 text-[#4a6a5a]">{amountWords}</p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
              Payment terms
            </p>
            <p className="mt-1.5 text-sm leading-6 text-[#1a3a2a]">
              {form.paymentTerms.trim() || DEFAULT_PAYMENT_TERMS}
            </p>
          </div>

          {userDefaults.bank_details ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                Payment details
              </p>
              <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[#1a3a2a]">
                {userDefaults.bank_details}
              </p>
            </div>
          ) : null}

          {userDefaults.payment_link_url ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                Pay online
              </p>
              <p className="mt-1.5 break-all text-sm leading-6 text-[#1a3a2a]">
                {paymentProviderLabel(userDefaults.payment_link_provider)}:{" "}
                {userDefaults.payment_link_url}
              </p>
            </div>
          ) : null}

          {userDefaults.late_payment_wording ? (
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#4a6a5a]">
                Late payment note
              </p>
              <p className="mt-1.5 text-sm leading-6 text-[#4a6a5a]">
                {userDefaults.late_payment_wording}
              </p>
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function formatPreviewDate(value: string) {
  const isoDate = parseInvoiceDateToIso(value);
  if (!isoDate) {
    return "Choose a date";
  }

  const date = new Date(`${isoDate}T00:00:00.000Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

const inputCls =
  "mt-2 h-12 w-full rounded-lg border border-[#d5d0c8] bg-white px-3 text-base text-[#1a3a2a] outline-none transition focus:border-[#2d6a4a] focus:ring-2 focus:ring-[#b9d2bd]";

function paymentProviderLabel(provider: string) {
  if (provider === "sumup") return "SumUp";
  if (provider === "stripe") return "Stripe Checkout";
  if (provider === "paypal") return "PayPal";
  return "Payment link";
}
