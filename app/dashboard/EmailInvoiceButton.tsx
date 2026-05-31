"use client";

import { useState } from "react";
import { formatPounds, amountToWords } from "@/lib/invoices/money";

type Props = {
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string;
  amountPence: number;
  dueDate: string | null;
  paymentTerms: string;
  senderName: string;
  paymentLinkUrl: string;
  hasPdf: boolean;
};

export default function EmailInvoiceButton({
  invoiceId,
  invoiceNumber,
  clientName,
  clientEmail,
  amountPence,
  dueDate,
  paymentTerms,
  senderName,
  paymentLinkUrl,
  hasPdf,
}: Props) {
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!hasPdf) return null;

  async function handleEmail() {
    setState("loading");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/invoices/share-url?id=${encodeURIComponent(invoiceId)}`);
      const data = await res.json() as { url?: string; error?: string };

      if (!res.ok || !data.url) {
        setErrorMsg(data.error ?? "Could not generate link.");
        setState("error");
        return;
      }

      const greeting = clientName ? `Hi ${clientName},` : "Hi,";
      const signoff = senderName || "VibeCount";
      const amountLine = `${formatPounds(amountPence)} (${amountToWords(amountPence)})`;
      const dueLine = dueDate ? `\nDue: ${formatDisplayDate(dueDate)}` : "";
      const paymentLine = paymentTerms ? `\nPayment terms: ${paymentTerms}` : "";
      const linkLine = paymentLinkUrl ? `\nPay online: ${paymentLinkUrl}` : "";

      const body = [
        greeting,
        "",
        `Please find invoice ${invoiceNumber} attached for ${amountLine}.`,
        `Download your copy here: ${data.url}`,
        `(Link valid for 30 days)`,
        dueLine + paymentLine + linkLine,
        "",
        `Thanks,`,
        signoff,
      ].join("\n").trim();

      const subject = `Invoice ${invoiceNumber}`;
      const mailto = `mailto:${encodeURIComponent(clientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      window.location.href = mailto;
      setState("idle");
    } catch {
      setErrorMsg("Could not open email client.");
      setState("error");
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleEmail}
        disabled={state === "loading"}
        data-testid={`email-invoice-button-${invoiceId}`}
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4] disabled:opacity-50"
      >
        {state === "loading" ? "Opening…" : "Email invoice"}
      </button>
      {state === "error" && (
        <p className="mt-1 text-xs text-[#7a271a]">{errorMsg}</p>
      )}
    </div>
  );
}

function formatDisplayDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(`${value}T00:00:00Z`));
  } catch {
    return value;
  }
}
