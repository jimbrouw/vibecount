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
  pdfShareUrl?: string;
  daysOverdue: number;
  lateFeePence: number;
};

export default function ChaseInvoiceButton({
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
  pdfShareUrl,
  daysOverdue,
  lateFeePence,
}: Props) {
  const [state, setState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  if (!hasPdf) return null;

  async function handleChase() {
    setState("loading");
    setErrorMsg("");

    try {
      let shareUrl = pdfShareUrl || "";
      if (!shareUrl) {
        const res = await fetch(`/api/invoices/share-url?id=${encodeURIComponent(invoiceId)}`);
        const data = await res.json() as { url?: string; error?: string };

        if (!res.ok || !data.url) {
          setErrorMsg(data.error ?? "Could not generate link.");
          setState("error");
          return;
        }
        shareUrl = data.url;
      }

      const greeting = clientName ? `Hi ${clientName},` : "Hi,";
      const signoff = senderName || "VibeCount";
      const amountFormatted = formatPounds(amountPence);
      const totalFormatted = formatPounds(amountPence + lateFeePence);
      const payLinkLine = paymentLinkUrl ? `Pay online: ${paymentLinkUrl}` : "";

      const lateFeeSentence = lateFeePence > 0
        ? `As per my payment terms and UK statutory regulations, a late payment fee and interest of ${formatPounds(lateFeePence)} has now been added, bringing the total due to ${totalFormatted}.`
        : "";

      const plainBody = [
        greeting,
        "",
        `I'm writing to gently remind you that invoice ${invoiceNumber} for ${amountFormatted} was due on ${formatDisplayDate(dueDate || "")} and is now ${daysOverdue} days overdue.`,
        "",
        lateFeeSentence,
        ...(lateFeeSentence ? [""] : []),
        `Could you please let me know when payment is scheduled to be made?`,
        "",
        `Download invoice: ${shareUrl}`,
        ...(payLinkLine ? [payLinkLine] : []),
        "",
        `Thanks,`,
        signoff,
      ].join("\n");

      const subject = `Overdue: Invoice ${invoiceNumber} — ${amountFormatted}`;
      const mailto = `mailto:${encodeURIComponent(clientEmail)}?subject=${encodeURIComponent(subject)}`;

      // Execute synchronous redirect to avoid popup blockers
      window.location.href = mailto;

      // Write HTML and text to clipboard asynchronously
      const htmlBody = buildEmailHtml(plainBody, shareUrl, invoiceNumber);
      if ("ClipboardItem" in window) {
        navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": new Blob([plainBody], { type: "text/plain" }),
            "text/html": new Blob([htmlBody], { type: "text/html" }),
          }),
        ]).catch(console.error);
      } else {
        navigator.clipboard.writeText(plainBody).catch(console.error);
      }

      setState("success");
      setTimeout(() => setState("idle"), 6000);
    } catch {
      setErrorMsg("Could not open email client.");
      setState("error");
    }
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleChase}
          disabled={state === "loading"}
          data-testid={`chase-invoice-button-${invoiceId}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#fef08a] bg-white px-3 text-xs font-semibold text-[#713f12] transition hover:bg-[#fefce8] disabled:opacity-50"
        >
          {state === "loading" ? "Opening…" : "Chase payment"}
        </button>
        {state === "success" && (
          <span className="text-xs text-[#854d0e]">Chase script copied! Press Cmd+V in your mail app.</span>
        )}
      </div>
      {state === "error" && (
        <p className="mt-1 text-xs text-[#7a271a]">{errorMsg}</p>
      )}
    </div>
  );
}

function buildEmailHtml(body: string, invoiceLinkUrl: string, invoiceNumber: string) {
  const escaped = escapeHtml(body);
  const linked = invoiceLinkUrl
    ? escaped.replace(escapeHtml(invoiceLinkUrl), `<a href="${escapeHtml(invoiceLinkUrl)}">${escapeHtml(invoiceNumber)}</a>`)
    : escaped;
  return `<div>${linked.replace(/\n/g, "<br>")}</div>`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDisplayDate(value: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" })
      .format(new Date(`${value}T00:00:00Z`));
  } catch {
    return value;
  }
}
