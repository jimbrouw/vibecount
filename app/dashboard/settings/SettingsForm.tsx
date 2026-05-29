"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import ExplainTerm from "@/app/dashboard/ExplainTerm";
import {
  AGENT_KEY_MASK,
  DEFAULT_LATE_PAYMENT_WORDING,
  EMPTY_SETTINGS,
  type UserSettings,
} from "@/lib/settings";

type Status = "idle" | "loading" | "saving" | "saved" | "error";
type ContactDetails = {
  email: string;
  phone: string;
  website: string;
  other: string;
};
type BankDetails = {
  accountName: string;
  sortCode: string;
  accountNumber: string;
  iban: string;
  swift: string;
  bankName: string;
  reference: string;
};

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

  const contact = parseContactDetails(settings.contact_details);
  const bank = parseBankDetails(settings.bank_details);

  const updateContact = useCallback((patch: Partial<ContactDetails>) => {
    setSettings((prev) => {
      const next = { ...parseContactDetails(prev.contact_details), ...patch };
      return { ...prev, contact_details: formatContactDetails(next) };
    });
  }, []);

  const updateBank = useCallback((patch: Partial<BankDetails>) => {
    setSettings((prev) => {
      const next = { ...parseBankDetails(prev.bank_details), ...patch };
      return { ...prev, bank_details: formatBankDetails(next) };
    });
  }, []);

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
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-3">
          <Field label="Email" hint="Shown on invoices." id="contact_email">
            <input
              id="contact_email"
              type="text"
              inputMode="email"
              value={contact.email}
              onChange={(e) => updateContact({ email: e.target.value })}
              placeholder="jane@example.com"
              className={inputCls}
            />
          </Field>
          <Field label="Phone" hint="Optional." id="contact_phone">
            <input
              id="contact_phone"
              type="tel"
              value={contact.phone}
              onChange={(e) => updateContact({ phone: e.target.value })}
              placeholder="07700 000000"
              className={inputCls}
            />
          </Field>
          <Field label="Website" hint="Optional." id="contact_website">
            <input
              id="contact_website"
              type="text"
              inputMode="url"
              value={contact.website}
              onChange={(e) => updateContact({ website: e.target.value })}
              placeholder="example.co.uk"
              className={inputCls}
            />
          </Field>
        </div>
        {contact.other ? (
          <div className="mt-5">
            <Field
              label="Other contact note"
              hint="Kept from older unstructured contact details."
              id="contact_other"
            >
              <input
                id="contact_other"
                type="text"
                value={contact.other}
                onChange={(e) => updateContact({ other: e.target.value })}
                className={inputCls}
              />
            </Field>
          </div>
        ) : null}
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
            labelAction={
              <button
                type="button"
                onClick={() =>
                  update("late_payment_wording", DEFAULT_LATE_PAYMENT_WORDING)
                }
                className="font-medium underline decoration-[#7a9a87] underline-offset-4 hover:text-[#1a3a2a]"
              >
                Use default
              </button>
            }
          >
            <textarea
              id="late_payment_wording"
              value={settings.late_payment_wording}
              onChange={(e) => update("late_payment_wording", e.target.value)}
              rows={4}
              placeholder={DEFAULT_LATE_PAYMENT_WORDING}
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
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Account name" hint="Usually your business or legal name." id="bank_account_name">
            <input
              id="bank_account_name"
              type="text"
              value={bank.accountName}
              onChange={(e) => updateBank({ accountName: e.target.value })}
              placeholder="Jane Smith"
              className={inputCls}
            />
          </Field>
          <Field label="Bank name" hint="Optional." id="bank_name">
            <input
              id="bank_name"
              type="text"
              value={bank.bankName}
              onChange={(e) => updateBank({ bankName: e.target.value })}
              placeholder="Barclays Bank"
              className={inputCls}
            />
          </Field>
          <Field label="Sort code" hint="Shown at the bottom of invoices." id="sort_code">
            <input
              id="sort_code"
              type="text"
              inputMode="numeric"
              value={bank.sortCode}
              onChange={(e) => updateBank({ sortCode: e.target.value })}
              placeholder="00-00-00"
              className={inputCls}
            />
          </Field>
          <Field label="Account number" hint="Shown at the bottom of invoices." id="account_number">
            <input
              id="account_number"
              type="text"
              inputMode="numeric"
              value={bank.accountNumber}
              onChange={(e) => updateBank({ accountNumber: e.target.value })}
              placeholder="12345678"
              className={inputCls}
            />
          </Field>
          <Field label="IBAN" hint="For international payments." id="iban">
            <input
              id="iban"
              type="text"
              value={bank.iban}
              onChange={(e) => updateBank({ iban: e.target.value.toUpperCase() })}
              placeholder="GB00 BUKB 2020 1512 3456 78"
              className={inputCls}
            />
          </Field>
          <Field label="SWIFT / BIC" hint="For international bank transfers." id="swift">
            <input
              id="swift"
              type="text"
              value={bank.swift}
              onChange={(e) => updateBank({ swift: e.target.value.toUpperCase() })}
              placeholder="BUKBGB22"
              className={inputCls}
            />
          </Field>
        </div>
        <div className="mt-5">
          <Field label="Payment reference or note" hint="Optional extra payment instruction." id="bank_reference">
            <input
              id="bank_reference"
              type="text"
              value={bank.reference}
              onChange={(e) => updateBank({ reference: e.target.value })}
              placeholder="Use the invoice number as the payment reference"
              className={inputCls}
            />
          </Field>
        </div>
      </fieldset>

      {/* VAT settings */}
      <fieldset className="rounded-xl border border-[#e5e0d8] bg-white p-6 shadow-sm">
        <legend className="mb-4 -ml-1 px-1 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
          VAT settings
        </legend>

        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium text-[#1a3a2a]">
          <span className="relative inline-flex h-6 w-11 shrink-0">
            <input
              type="checkbox"
              checked={settings.vat_registered}
              onChange={(e) => update("vat_registered", e.target.checked)}
              className="sr-only"
              id="vat_registered"
            />
            <span
              aria-hidden="true"
              className={`h-6 w-11 rounded-full transition-colors duration-200 ${
                settings.vat_registered ? "bg-[#2d6a4a]" : "bg-[#d5d0c8]"
              }`}
            />
            <span
              aria-hidden="true"
              className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
                settings.vat_registered ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </span>
          <span>I am VAT registered</span>
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

      {/* Agent settings */}
      <fieldset className="rounded-xl border border-[#e5e0d8] bg-white p-6 shadow-sm">
        <legend className="mb-1 -ml-1 px-1 text-xs font-semibold uppercase tracking-widest text-[#4a6a5a]">
          Agent
        </legend>
        <p className="mb-4 text-xs text-[#7a9a87]">
          Bring your own LLM key to power the in-app agent. Your key is stored
          securely and used only for your own account. It is never shown again
          after saving.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="AI provider" id="agent_provider">
            <select
              id="agent_provider"
              value={settings.agent_provider}
              onChange={(e) =>
                update("agent_provider", e.target.value as "anthropic" | "openai")
              }
              className={`${inputCls} cursor-pointer`}
            >
              <option value="anthropic">Anthropic (Claude)</option>
              <option value="openai">OpenAI (GPT-4o)</option>
            </select>
          </Field>
          <Field
            label="API key"
            hint={
              settings.agent_api_key === AGENT_KEY_MASK
                ? "A key is saved. Enter a new one to replace it, or clear to remove."
                : "Paste your Anthropic or OpenAI API key."
            }
            id="agent_api_key"
          >
            <input
              id="agent_api_key"
              type="password"
              autoComplete="off"
              value={settings.agent_api_key}
              onChange={(e) => update("agent_api_key", e.target.value)}
              placeholder={
                settings.agent_api_key === AGENT_KEY_MASK
                  ? "••••••••  (key is saved)"
                  : "sk-ant-api03-… or sk-…"
              }
              className={inputCls}
            />
          </Field>
        </div>

        <div className="mt-6 border-t border-[#f0ece4] pt-5">
          <p className="mb-2 text-xs font-medium text-[#1a3a2a]">
            VibeCount API key — for external agents
          </p>
          <p className="mb-3 text-xs text-[#7a9a87]">
            Connect Claude Code, Codex, or any MCP-compatible agent to your
            VibeCount account. Send requests to{" "}
            <code className="rounded bg-[#f0ece4] px-1 py-0.5 font-mono text-[10px] text-[#1a3a2a]">
              POST /api/mcp
            </code>{" "}
            with{" "}
            <code className="rounded bg-[#f0ece4] px-1 py-0.5 font-mono text-[10px] text-[#1a3a2a]">
              Authorization: Bearer &lt;key&gt;
            </code>
            .
          </p>
          <VibecountApiKey />
        </div>
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

function VibecountApiKey() {
  const [keyState, setKeyState] = useState<
    | { status: "loading" }
    | { status: "none" }
    | { status: "exists"; preview: string }
    | { status: "generated"; key: string }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/agent/key")
      .then((r) => r.json())
      .then((data) => {
        if (data.set) {
          setKeyState({ status: "exists", preview: data.preview });
        } else {
          setKeyState({ status: "none" });
        }
      })
      .catch(() => setKeyState({ status: "error", message: "Could not load key status." }));
  }, []);

  async function generate() {
    setGenerating(true);
    try {
      const res = await fetch("/api/agent/key", { method: "POST" });
      const data = await res.json();
      if (data.key) {
        setKeyState({ status: "generated", key: data.key });
      } else {
        setKeyState({ status: "error", message: data.error ?? "Generation failed." });
      }
    } catch {
      setKeyState({ status: "error", message: "Could not generate key." });
    } finally {
      setGenerating(false);
    }
  }

  async function revoke() {
    await fetch("/api/agent/key", { method: "DELETE" });
    setKeyState({ status: "none" });
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (keyState.status === "loading") {
    return <p className="text-xs text-[#7a9a87]">Loading…</p>;
  }

  if (keyState.status === "error") {
    return <p className="text-xs text-red-600">{keyState.message}</p>;
  }

  if (keyState.status === "generated") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
        <p className="mb-1 text-xs font-semibold text-amber-800">
          Copy your key now — it will not be shown again.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-xs text-[#1a3a2a] break-all border border-amber-200">
            {keyState.key}
          </code>
          <button
            type="button"
            onClick={() => copyKey(keyState.key)}
            className="shrink-0 rounded-lg bg-amber-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-amber-800"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setKeyState({ status: "exists", preview: `vc_live_...${keyState.key.slice(-8)}` })}
          className="mt-2 text-xs text-amber-700 underline"
        >
          I have saved it
        </button>
      </div>
    );
  }

  if (keyState.status === "none") {
    return (
      <button
        type="button"
        onClick={generate}
        disabled={generating}
        className="inline-flex h-9 items-center rounded-lg border border-[#d5d0c8] bg-white px-4 text-xs font-semibold text-[#1a3a2a] transition hover:bg-[#f5f2ee] disabled:opacity-50"
      >
        {generating ? "Generating…" : "Generate API key"}
      </button>
    );
  }

  // exists
  return (
    <div className="flex items-center gap-3">
      <code className="rounded bg-[#f0ece4] px-3 py-1.5 font-mono text-xs text-[#1a3a2a]">
        {keyState.preview}
      </code>
      <button
        type="button"
        onClick={generate}
        disabled={generating}
        className="text-xs font-medium text-[#4a6a5a] underline decoration-[#7a9a87] underline-offset-2 hover:text-[#1a3a2a] disabled:opacity-50"
      >
        {generating ? "Regenerating…" : "Regenerate"}
      </button>
      <button
        type="button"
        onClick={revoke}
        className="text-xs font-medium text-[#7a271a] underline underline-offset-2 hover:text-red-700"
      >
        Revoke
      </button>
    </div>
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

function parseContactDetails(value: string): ContactDetails {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const contact: ContactDetails = { email: "", phone: "", website: "", other: "" };
  const other: string[] = [];

  for (const line of lines) {
    const [rawLabel, ...rest] = line.split(":");
    const label = rawLabel?.trim().toLowerCase();
    const content = rest.join(":").trim();

    if (content && label === "email") contact.email = content;
    else if (content && label === "phone") contact.phone = content;
    else if (content && label === "website") contact.website = content;
    else if (!contact.email && line.includes("@")) contact.email = line;
    else if (!contact.website && /^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(line)) {
      contact.website = line;
    } else if (!contact.phone && /[0-9]{5,}/.test(line)) {
      contact.phone = line;
    } else {
      other.push(line);
    }
  }

  contact.other = other.join(" · ");
  return contact;
}

function formatContactDetails(contact: ContactDetails) {
  return [
    ["Email", contact.email],
    ["Phone", contact.phone],
    ["Website", contact.website],
    ["Other", contact.other],
  ]
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}: ${value.trim()}`)
    .join("\n");
}

function parseBankDetails(value: string): BankDetails {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bank: BankDetails = {
    accountName: "",
    sortCode: "",
    accountNumber: "",
    iban: "",
    swift: "",
    bankName: "",
    reference: "",
  };
  const other: string[] = [];

  for (const line of lines) {
    const [rawLabel, ...rest] = line.split(":");
    const label = rawLabel?.trim().toLowerCase();
    const content = rest.join(":").trim();

    if (content && (label === "account name" || label === "name")) bank.accountName = content;
    else if (content && label === "sort code") bank.sortCode = content;
    else if (content && label === "account number") bank.accountNumber = content;
    else if (content && label === "iban") bank.iban = content;
    else if (content && (label === "swift" || label === "swift / bic" || label === "bic")) {
      bank.swift = content;
    }
    else if (content && label === "bank") bank.bankName = content;
    else if (content && (label === "reference" || label === "payment reference")) {
      bank.reference = content;
    } else if (!bank.sortCode && /^\d{2}-?\d{2}-?\d{2}$/.test(line)) {
      bank.sortCode = line;
    } else if (!bank.accountNumber && /^\d{8}$/.test(line)) {
      bank.accountNumber = line;
    } else {
      other.push(line);
    }
  }

  if (other.length && !bank.bankName) bank.bankName = other.shift() ?? "";
  if (other.length) bank.reference = other.join(" · ");
  return bank;
}

function formatBankDetails(bank: BankDetails) {
  return [
    ["Account name", bank.accountName],
    ["Sort code", bank.sortCode],
    ["Account number", bank.accountNumber],
    ["IBAN", bank.iban],
    ["SWIFT / BIC", bank.swift],
    ["Bank", bank.bankName],
    ["Reference", bank.reference],
  ]
    .filter(([, value]) => value.trim())
    .map(([label, value]) => `${label}: ${value.trim()}`)
    .join("\n");
}
