import { formatPounds } from "./money.ts";

export type ChaserTone = "gentle" | "standard" | "firm";

export type ChaserParams = {
  invoiceNumber: string;
  clientName: string;
  amountPence: number;
  dueDate: string | null;
  daysOverdue: number;
  lateFeePence: number;
  senderName: string;
  paymentLinkUrl: string;
  pdfShareUrl?: string;
};

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00Z");
  return isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

/**
 * Generates tailored invoice chase copy across Gentle, Standard, and Firm tones.
 */
export function generateChaserCopy(tone: ChaserTone, params: ChaserParams): {
  subject: string;
  body: string;
  headline: string;
} {
  const greeting = params.clientName ? `Hi ${params.clientName},` : "Hi,";
  const signoff = params.senderName || "Thanks";
  const amountFormatted = formatPounds(params.amountPence);
  const totalFormatted = formatPounds(params.amountPence + params.lateFeePence);
  const dueFormatted = formatDisplayDate(params.dueDate || "");
  const payLinkLine = params.paymentLinkUrl ? `Pay online: ${params.paymentLinkUrl}` : "";
  const downloadLine = params.pdfShareUrl ? `Download invoice: ${params.pdfShareUrl}` : "";

  if (tone === "gentle") {
    return {
      headline: "Gentle & Warm Nudge",
      subject: `Quick check-in: Invoice ${params.invoiceNumber} (${amountFormatted})`,
      body: [
        greeting,
        "",
        `Hope you're having a great week!`,
        "",
        `Just a quick friendly check-in on invoice ${params.invoiceNumber} for ${amountFormatted}${
          dueFormatted ? `, which was due on ${dueFormatted}` : ""
        }.`,
        "",
        `I know how easily emails slip under the radar. Could you take a quick look and let me know when this is scheduled for payment?`,
        "",
        ...(downloadLine ? [downloadLine] : []),
        ...(payLinkLine ? [payLinkLine] : []),
        "",
        `Thanks so much,`,
        signoff,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (tone === "firm") {
    const overdueDaysText = params.daysOverdue > 0 ? `now ${params.daysOverdue} days overdue` : "now overdue";
    const lateFeeSentence =
      params.lateFeePence > 0
        ? `Under UK Late Payment legislation, a statutory compensation fee and interest of ${formatPounds(
            params.lateFeePence,
          )} has been applied, making the revised total due ${totalFormatted}.`
        : "Under the Late Payment of Commercial Debts Regulations, statutory interest and compensation may apply if payment remains outstanding.";

    return {
      headline: "Firm & Professional Notice",
      subject: `OVERDUE: Invoice ${params.invoiceNumber} — ${amountFormatted}`,
      body: [
        greeting,
        "",
        `I am writing regarding invoice ${params.invoiceNumber} for ${amountFormatted}, which was due on ${
          dueFormatted || "the agreed date"
        } and is ${overdueDaysText}.`,
        "",
        lateFeeSentence,
        "",
        `Please arrange payment by return or confirm the exact remittance date today.`,
        "",
        ...(downloadLine ? [downloadLine] : []),
        ...(payLinkLine ? [payLinkLine] : []),
        "",
        `Regards,`,
        signoff,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  // Standard tone
  return {
    headline: "Standard Business Follow-up",
    subject: `Overdue: Invoice ${params.invoiceNumber} — ${amountFormatted}`,
    body: [
      greeting,
      "",
      `Following up on invoice ${params.invoiceNumber} for ${amountFormatted}${
        dueFormatted ? `, which was due on ${dueFormatted}` : ""
      }${params.daysOverdue > 0 ? ` and is now ${params.daysOverdue} days overdue` : ""}.`,
      "",
      `Could you please let me know when payment will be processed?`,
      "",
      ...(downloadLine ? [downloadLine] : []),
      ...(payLinkLine ? [payLinkLine] : []),
      "",
      `Best regards,`,
      signoff,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
