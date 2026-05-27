const SMALL_NUMBERS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];

const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

export function normaliseClientName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function parseAmountToPence(value: string | number) {
  const raw = String(value).trim().replace(/[£,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
    return null;
  }

  const [pounds, pence = ""] = raw.split(".");
  return Number(pounds) * 100 + Number(pence.padEnd(2, "0"));
}

export function formatPounds(pence: number) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(pence / 100);
}

export function amountToWords(pence: number) {
  if (!Number.isSafeInteger(pence) || pence < 0) {
    return "";
  }

  const pounds = Math.floor(pence / 100);
  const pennies = pence % 100;
  const poundLabel = pounds === 1 ? "pound" : "pounds";

  if (pennies === 0) {
    return `${numberToWords(pounds)} ${poundLabel}`;
  }

  const pennyLabel = pennies === 1 ? "penny" : "pence";
  return `${numberToWords(pounds)} ${poundLabel} and ${numberToWords(
    pennies
  )} ${pennyLabel}`;
}

function numberToWords(value: number): string {
  if (value < 20) {
    return SMALL_NUMBERS[value];
  }

  if (value < 100) {
    const tens = Math.floor(value / 10);
    const remainder = value % 10;
    return remainder ? `${TENS[tens]}-${SMALL_NUMBERS[remainder]}` : TENS[tens];
  }

  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const remainder = value % 100;
    return remainder
      ? `${SMALL_NUMBERS[hundreds]} hundred and ${numberToWords(remainder)}`
      : `${SMALL_NUMBERS[hundreds]} hundred`;
  }

  if (value < 1_000_000) {
    const thousands = Math.floor(value / 1000);
    const remainder = value % 1000;
    return remainder
      ? `${numberToWords(thousands)} thousand ${numberToWords(remainder)}`
      : `${numberToWords(thousands)} thousand`;
  }

  const millions = Math.floor(value / 1_000_000);
  const remainder = value % 1_000_000;
  return remainder
    ? `${numberToWords(millions)} million ${numberToWords(remainder)}`
    : `${numberToWords(millions)} million`;
}
