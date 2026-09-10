"use client";

import { useState } from "react";

type Props = {
  quoteId: string;
  clientName: string;
  quoteNumber: string;
  amount: string;
  validUntil: string;
  senderName: string;
};

export default function QuoteEmailButton({
  quoteId,
  clientName,
  quoteNumber,
  amount,
  validUntil,
  senderName,
}: Props) {
  const [status, setStatus] = useState<"idle" | "loading">("idle");

  async function openEmail() {
    setStatus("loading");
    try {
      const response = await fetch(`/api/quotes/${quoteId}/share-url`);
      const body = await response.json().catch(() => null) as { url?: string } | null;
      const url = body?.url ?? `${window.location.origin}/api/quotes/${quoteId}/pdf`;
      const subject = `Quote ${quoteNumber}`;
      const text = buildQuoteEmail({
        clientName,
        quoteNumber,
        amount,
        validUntil,
        senderName,
        url,
      });
      window.location.href = `mailto:?subject=${encodeMailtoParam(subject)}&body=${encodeMailtoParam(text)}`;
    } finally {
      setStatus("idle");
    }
  }

  return (
    <button type="button" onClick={openEmail} className={buttonCls} disabled={status === "loading"}>
      {status === "loading" ? "Preparing..." : "Email"}
    </button>
  );
}

function buildQuoteEmail(input: {
  clientName: string;
  quoteNumber: string;
  amount: string;
  validUntil: string;
  senderName: string;
  url: string;
}) {
  const greeting = input.clientName ? `Hi ${input.clientName},` : "Hi,";
  const expiry = input.validUntil ? `\nValid until: ${input.validUntil}` : "";
  return `${greeting}

Please find quote ${input.quoteNumber} for ${input.amount} linked below.

Download quote PDF: ${input.url}
(Link valid for 30 days)${expiry}

If you would like to go ahead, just reply to this email.

Thanks,
${input.senderName || "VibeCount"}`;
}

const buttonCls =
  "inline-flex h-9 items-center rounded-lg border border-[#bbf7d0] bg-white px-3 text-xs font-semibold text-[#14532d] transition hover:bg-[#f0fdf4] disabled:opacity-60";

function encodeMailtoParam(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}
