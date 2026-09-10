import { readFileSync } from "node:fs";

type GateRow = {
  file: string;
  expected_amount_pence: string;
  extracted_amount_pence: string;
  notes?: string;
};

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Usage: npx tsx scripts/score-whisper-gate.ts <results.csv>");
  process.exit(1);
}

const rows = parseCsv(readFileSync(inputPath, "utf8"));
if (rows.length < 20) {
  console.error(`Gate requires at least 20 phrases. Found ${rows.length}.`);
  process.exit(1);
}

const results = rows.map((row) => {
  const expected = Number(row.expected_amount_pence);
  const extracted = Number(row.extracted_amount_pence);
  return {
    file: row.file,
    expected,
    extracted,
    pass: Number.isFinite(expected) && expected === extracted,
    notes: row.notes ?? "",
  };
});

const passCount = results.filter((result) => result.pass).length;
const accuracy = passCount / results.length;
const passedGate = accuracy >= 0.9;

console.log(`Whisper amount accuracy: ${(accuracy * 100).toFixed(1)}% (${passCount}/${results.length})`);
console.log(passedGate ? "PASS: voice gate can proceed." : "FAIL: keep voice behind typed invoices.");

for (const result of results.filter((item) => !item.pass)) {
  console.log(
    `Mismatch: ${result.file} expected ${result.expected}, extracted ${result.extracted}${result.notes ? ` (${result.notes})` : ""}`
  );
}

process.exit(passedGate ? 0 : 1);

function parseCsv(content: string): GateRow[] {
  const [headerLine, ...lines] = content.trim().split(/\r?\n/);
  if (!headerLine) return [];

  const headers = splitCsvLine(headerLine);
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const cells = splitCsvLine(line);
      return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])) as GateRow;
    });
}

function splitCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}
