"use client";

import { useState } from "react";
import { formatPounds } from "@/lib/invoices/money";
import {
  generateChaserCopy,
  type ChaserTone,
} from "@/lib/invoices/chaser-templates";

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

export default function ChaseInvoiceButton(props: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [tone, setTone] = useState<ChaserTone>("gentle");
  const [copied, setCopied] = useState(false);
  const [shareUrl, setShareUrl] = useState(props.pdfShareUrl || "");
  const [loadingUrl, setLoadingUrl] = useState(false);

  if (!props.hasPdf) return null;

  async function openModal() {
    setIsOpen(true);
    setCopied(false);
    if (!shareUrl) {
      setLoadingUrl(true);
      try {
        const res = await fetch(
          `/api/invoices/share-url?id=${encodeURIComponent(props.invoiceId)}`,
        );
        const data = (await res.json()) as { url?: string; error?: string };
        if (data.url) setShareUrl(data.url);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingUrl(false);
      }
    }
  }

  const chaser = generateChaserCopy(tone, {
    invoiceNumber: props.invoiceNumber,
    clientName: props.clientName,
    amountPence: props.amountPence,
    dueDate: props.dueDate,
    daysOverdue: props.daysOverdue,
    lateFeePence: props.lateFeePence,
    senderName: props.senderName,
    paymentLinkUrl: props.paymentLinkUrl,
    pdfShareUrl: shareUrl,
  });

  const [customText, setCustomText] = useState("");
  const activeBody = customText || chaser.body;

  function handleToneChange(newTone: ChaserTone) {
    setTone(newTone);
    setCustomText("");
    setCopied(false);
  }

  function handleCopy() {
    navigator.clipboard.writeText(activeBody).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 5000);
    });
  }

  function handleOpenMail() {
    const mailto = `mailto:${encodeURIComponent(props.clientEmail)}?subject=${encodeURIComponent(
      chaser.subject,
    )}&body=${encodeURIComponent(activeBody)}`;
    window.location.href = mailto;
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        data-testid={`chase-invoice-button-${props.invoiceId}`}
        className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-[#fef08a] bg-white px-3 text-xs font-semibold text-[#713f12] transition hover:bg-[#fefce8]"
      >
        💬 Chase payment
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="chase-modal"
        >
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl space-y-5">
            <div className="flex items-start justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-[#14532d]">
                  Draft Polite Reminder
                </h3>
                <p className="mt-0.5 text-xs text-[#4b8068]">
                  Invoice #{props.invoiceNumber} · {formatPounds(props.amountPence)} to{" "}
                  {props.clientName || "Client"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="cursor-pointer text-gray-400 hover:text-gray-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {/* Tone Selector */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-[#14532d]">
                Choose Tone:
              </label>
              <div className="flex gap-2">
                {(
                  [
                    { id: "gentle", label: "🌸 Gentle Nudge", desc: "Friendly check-in" },
                    { id: "standard", label: "💼 Standard", desc: "Professional follow-up" },
                    { id: "firm", label: "⚖️ Firm", desc: "Statutory notice" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleToneChange(t.id)}
                    data-testid={`chase-tone-${t.id}`}
                    className={`flex-1 cursor-pointer rounded-xl border p-2.5 text-left transition ${
                      tone === t.id
                        ? "border-[#15803d] bg-[#dcfce7] text-[#14532d] shadow-xs"
                        : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <p className="text-xs font-bold">{t.label}</p>
                    <p className="text-[10px] opacity-75">{t.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Message Preview / Editor */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#14532d]">
                  Subject: {chaser.subject}
                </label>
                <span className="text-[11px] text-[#4b8068]">
                  {loadingUrl ? "Generating PDF link…" : "Editable before sending"}
                </span>
              </div>
              <textarea
                rows={8}
                value={activeBody}
                onChange={(e) => setCustomText(e.target.value)}
                data-testid="chase-message-textarea"
                className="w-full rounded-xl border border-[#c8d4cb] p-3 text-xs leading-relaxed text-gray-800 focus:border-[#15803d] focus:outline-hidden font-mono"
              />
            </div>

            {/* Safety Reassurance */}
            <div className="rounded-xl border border-[#bbf7d0] bg-[#f0fdf4] p-3 text-xs text-[#166534]">
              🛡️ <strong>Safety check:</strong> VibeCount never automatically emails clients. You copy the message or send it yourself via your preferred email or messaging app.
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={handleCopy}
                data-testid="chase-copy-btn"
                className="cursor-pointer rounded-xl border border-[#15803d] bg-white px-4 py-2 text-xs font-bold text-[#15803d] hover:bg-[#f0fdf4]"
              >
                {copied ? "✓ Copied to Clipboard!" : "📋 Copy for WhatsApp / Slack"}
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="cursor-pointer rounded-xl px-3 py-2 text-xs text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleOpenMail}
                  data-testid="chase-mail-btn"
                  className="cursor-pointer rounded-xl bg-[#15803d] px-5 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#14532d]"
                >
                  ✉️ Open in Mail
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
