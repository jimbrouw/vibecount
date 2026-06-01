import { formatPounds } from "./money";

export const DEFAULT_REMINDER_SCHEDULE = {
  firstReminderDaysAfterDue: 3,
  repeatEveryDays: 7,
  maxReminders: 3,
};

export type ReminderSchedule = typeof DEFAULT_REMINDER_SCHEDULE;

export type ReminderInvoice = {
  number: string;
  amountPence: number;
  invoiceDate: string;
  dueDate: string;
  paymentTerms: string;
  paymentLinkUrl: string;
};

export type ReminderClient = {
  name: string;
  email: string;
};

export type ReminderSender = {
  name: string;
  email: string;
};

export function inferDueDate(invoiceDate: string, paymentTerms: string) {
  const base = parseIsoDate(invoiceDate) ?? new Date();
  const days = extractPaymentTermDays(paymentTerms) ?? 30;
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

export function firstReminderAt(dueDate: string, now = new Date()) {
  const due = parseIsoDate(dueDate) ?? now;
  due.setUTCDate(due.getUTCDate() + DEFAULT_REMINDER_SCHEDULE.firstReminderDaysAfterDue);
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return new Date(Math.max(due.getTime(), today.getTime())).toISOString();
}

export function nextReminderAtFrom(now = new Date(), repeatEveryDays = DEFAULT_REMINDER_SCHEDULE.repeatEveryDays) {
  const next = new Date(now);
  next.setUTCDate(next.getUTCDate() + repeatEveryDays);
  return next.toISOString();
}

export function buildInvoiceEmailDraft(input: {
  invoiceNumber: string;
  clientName: string;
  amountPence: number;
  dueDate: string;
  paymentTerms: string;
  paymentLinkUrl: string;
  senderName: string;
}) {
  const subject = `Invoice ${input.invoiceNumber}`;
  const greeting = input.clientName ? `Hi ${input.clientName},` : "Hi,";
  const signoff = input.senderName || "VibeCount";
  const paymentLine = input.paymentLinkUrl
    ? `\n\nYou can also pay online here:\n${input.paymentLinkUrl}`
    : "";
  const body = `${greeting}

Please find invoice ${input.invoiceNumber} attached for ${formatPounds(input.amountPence)}.

Payment terms: ${input.paymentTerms}
Due date: ${formatDisplayDate(input.dueDate)}${paymentLine}

Thanks,
${signoff}`;

  return { subject, body };
}

export function buildReminderEmail(input: {
  invoice: ReminderInvoice;
  client: ReminderClient;
  sender: ReminderSender;
  reminderCount: number;
}) {
  const subject = `Payment reminder for invoice ${input.invoice.number}`;
  const paymentLine = input.invoice.paymentLinkUrl
    ? `\n\nYou can pay online here:\n${input.invoice.paymentLinkUrl}`
    : "";
  const senderName = input.sender.name || input.sender.email || "VibeCount";
  const text = `Hi ${input.client.name},

This is a payment reminder for invoice ${input.invoice.number}.

Amount due: ${formatPounds(input.invoice.amountPence)}
Due date: ${formatDisplayDate(input.invoice.dueDate)}
Payment terms: ${input.invoice.paymentTerms}${paymentLine}

Please ignore this message if payment has already been made.

Thanks,
${senderName}`;

  return { subject, text };
}

export function parseReminderSchedule(value: unknown): ReminderSchedule {
  if (!value || typeof value !== "object") {
    return DEFAULT_REMINDER_SCHEDULE;
  }

  const input = value as Partial<Record<keyof ReminderSchedule, unknown>>;
  return {
    firstReminderDaysAfterDue:
      safePositiveInteger(input.firstReminderDaysAfterDue) ??
      DEFAULT_REMINDER_SCHEDULE.firstReminderDaysAfterDue,
    repeatEveryDays:
      safePositiveInteger(input.repeatEveryDays) ?? DEFAULT_REMINDER_SCHEDULE.repeatEveryDays,
    maxReminders:
      safePositiveInteger(input.maxReminders) ?? DEFAULT_REMINDER_SCHEDULE.maxReminders,
  };
}

export function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function extractPaymentTermDays(paymentTerms: string) {
  const match = paymentTerms.match(/(\d{1,3})\s*days?/i);
  if (!match) return null;
  const days = Number(match[1]);
  return Number.isInteger(days) && days > 0 && days <= 365 ? days : null;
}

function parseIsoDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText)));
  return Number.isNaN(date.getTime()) ? null : date;
}

function safePositiveInteger(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function formatDisplayDate(value: string) {
  const date = parseIsoDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}
