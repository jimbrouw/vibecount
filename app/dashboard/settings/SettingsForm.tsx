"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ExplainTerm from "@/app/dashboard/ExplainTerm";
import { EMPTY_SETTINGS, type UserSettings } from "@/lib/settings";

type Status = "idle" | "loading" | "saving" | "saved" | "error";

export default function SettingsForm() {
  const [settings, setSettings] = useState<UserSettings>(EMPTY_SETTINGS);
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const savedRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data && !data.error) {
          setSettings((prev) => ({ ...prev, ...data }));
        }
        setStatus("idle");
      })
      .catch(() => setStatus("idle"));
  }, []);

  const update = useCallback(
    <K extends keyof UserSettings>(field: K, value: UserSettings[K]) => {
      setSettings((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("saving");
    setErrorMsg("");

    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setErrorMsg(body?.error ?? "Could not save settings.");
      setStatus("error");
      return;
    }

    setStatus("saved");
    if (savedRef.current) clearTimeout(savedRef.current);
    savedRef.current = setTimeout(() => setStatus("idle"), 3000);
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center py-24 text-sm text-[#4a6a5a]">
        Loading your settings…
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-10">
      {/* Trading identity */}
      <fieldset className="rounded-xl border border-[#e5e0d8] bg-white p-6 shadow-sm">
        <legend className="mb-4 -ml-1 px-1 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
          Trading identity
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Legal / trading name"
            hint="Appears on every invoice."
            id="legal_name"
          >
            <input
              id="legal_name"
              type="text"
              value={settings.legal_name}
              onChange={(e) => update("legal_name", e.target.value)}
              placeholder="Jane Smith Creative Ltd"
              className={inputCls}
            />
          </Field>
          <Field label="Contact details" hint="Email, phone, or website." id="contact_details">
            <input
              id="contact_details"
              type="text"
              value={settings.contact_details}
              onChange={(e) => update("contact_details", e.target.value)}
              placeholder="jane@example.com · 07700 000000"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="mt-5">
          <Field label="Address" hint="Your trading or correspondence address." id="address">
            <textarea
              id="address"
              value={settings.address}
              onChange={(e) => update("address", e.target.value)}
              rows={3}
              placeholder={"12 Creative Lane\nLondon\nEC1A 1BB"}
              className={`${inputCls} h-auto resize-y py-3`}
            />
          </Field>
        </div>
      </fieldset>

      {/* Invoice defaults */}
      <fieldset className="rounded-xl border border-[#e5e0d8] bg-white p-6 shadow-sm">
        <legend className="mb-4 -ml-1 px-1 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
          Invoice defaults
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Invoice number prefix"
            hint="e.g. 'INV' → INV-2026-0001"
            id="invoice_number_prefix"
          >
            <input
              id="invoice_number_prefix"
              type="text"
              maxLength={10}
              value={settings.invoice_number_prefix}
              onChange={(e) =>
                update("invoice_number_prefix", e.target.value.toUpperCase())
              }
              placeholder="VC"
              className={inputCls}
            />
          </Field>
          <Field
            label="Default payment terms"
            hint="Pre-filled on new invoices."
            id="default_payment_terms"
          >
            <input
              id="default_payment_terms"
              type="text"
              value={settings.default_payment_terms}
              onChange={(e) => update("default_payment_terms", e.target.value)}
              placeholder="Payment due within 30 days"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="mt-5">
          <Field
            label="Late payment wording"
            hint="Printed at the bottom of every invoice."
            id="late_payment_wording"
          >
            <textarea
              id="late_payment_wording"
              value={settings.late_payment_wording}
              onChange={(e) => update("late_payment_wording", e.target.value)}
              rows={2}
              className={`${inputCls} h-auto resize-y py-3`}
            />
          </Field>
        </div>
      </fieldset>

      {/* Bank details */}
      <fieldset className="rounded-xl border border-[#e5e0d8] bg-white p-6 shadow-sm">
        <legend className="mb-4 -ml-1 px-1 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
          Bank details
        </legend>
        <Field
          label="Bank details"
          hint="Shown at the bottom of invoices so clients know where to pay."
          id="bank_details"
        >
          <textarea
            id="bank_details"
            value={settings.bank_details}
            onChange={(e) => update("bank_details", e.target.value)}
            rows={3}
            placeholder={"Sort code: 00-00-00\nAccount number: 12345678\nBarclays Bank"}
            className={`${inputCls} h-auto resize-y py-3`}
          />
        </Field>
      </fieldset>

      {/* VAT settings */}
      <fieldset className="rounded-xl border border-[#e5e0d8] bg-white p-6 shadow-sm">
        <legend className="mb-4 -ml-1 px-1 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
          VAT settings
        </legend>

        {/* VAT registered toggle */}
        <label className="flex cursor-pointer items-center gap-3">
          <div className="relative">
            <input
              type="checkbox"
              checked={settings.vat_registered}
              onChange={(e) => update("vat_registered", e.target.checked)}
              className="sr-only"
              id="vat_registered"
            />
            <div
              className={`h-6 w-11 rounded-full transition-colors duration-200 ${
                settings.vat_registered ? "bg-[#2d6a4a]" : "bg-[#d5d0c8]"
              }`}
            />
            <div
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                settings.vat_registered ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </div>
          <span className="text-sm font-medium text-[#1a3a2a]">
            I am VAT registered
          </span>
        </label>

        {settings.vat_registered && (
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Field
              label="VAT registration number"
              id="vat_number"
              labelAction={<ExplainTerm term="Value Added Tax (VAT)">What is VAT?</ExplainTerm>}
            >
              <input
                id="vat_number"
                type="text"
                value={settings.vat_number}
                onChange={(e) => update("vat_number", e.target.value)}
                placeholder="GB 123 4567 89"
                className={inputCls}
              />
            </Field>
            <Field label="VAT rate (%)" id="vat_rate">
              <input
                id="vat_rate"
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={settings.vat_rate}
                onChange={(e) => update("vat_rate", Number(e.target.value))}
                className={inputCls}
              />
            </Field>
          </div>
        )}
      </fieldset>

      {/* Private info */}
      <fieldset className="rounded-xl border border-[#e5e0d8] bg-white p-6 shadow-sm">
        <legend className="mb-1 -ml-1 px-1 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
          Private info
        </legend>
        <p className="mb-4 text-xs text-[#7a9a87]">
          Stored securely and never shown on invoices. Your UTR is not a normal invoice
          requirement.
        </p>
        <Field
          label="Unique Taxpayer Reference (UTR)"
          hint="10 digits. Required for Self Assessment only."
          id="utr"
          labelAction={
            <ExplainTerm term="Unique Taxpayer Reference">Explain UTR</ExplainTerm>
          }
        >
          <input
            id="utr"
            type="text"
            inputMode="numeric"
            maxLength={10}
            value={settings.utr}
            onChange={(e) => update("utr", e.target.value)}
            placeholder="1234567890"
            className={inputCls}
          />
        </Field>
      </fieldset>

      {/* Status feedback + submit */}
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <button
          type="submit"
          disabled={status === "saving"}
          className="inline-flex h-12 items-center justify-center rounded-xl bg-[#1a3a2a] px-8 text-sm font-semibold text-white transition hover:bg-[#2d6a4a] disabled:cursor-not-allowed disabled:bg-[#8a9a91]"
        >
          {status === "saving" ? "Saving…" : "Save settings"}
        </button>

        {status === "saved" && (
          <p className="flex items-center gap-2 text-sm text-[#2d6a4a]">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="8" fill="#2d6a4a" fillOpacity=".12" />
              <path
                d="M4.5 8l2.5 2.5L11.5 6"
                stroke="#2d6a4a"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Settings saved.
          </p>
        )}

        {status === "error" && (
          <p className="text-sm text-[#7a271a]">{errorMsg}</p>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  id,
  labelAction,
  children,
}: {
  label: string;
  hint?: string;
  id: string;
  labelAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-[#1a3a2a]">
          {label}
        </label>
        {labelAction ? <span className="text-xs text-[#4a6a5a]">{labelAction}</span> : null}
      </div>
      {hint && <p className="mt-0.5 text-xs text-[#7a9a87]">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

const inputCls =
  "h-12 w-full rounded-lg border border-[#d5d0c8] bg-white px-3 text-base text-[#1a3a2a] outline-none transition focus:border-[#2d6a4a] focus:ring-2 focus:ring-[#b9d2bd]";
