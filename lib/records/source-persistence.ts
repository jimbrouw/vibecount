import { randomUUID } from "node:crypto";
import { redactBankDetailsForPrompt } from "../ai/redaction";
import { sumPence } from "../money";
import { encryptSource, sourceContext, sourceHash } from "./source-crypto";
import {
  normalizeSourceCsv,
  readSourceCsv,
  SOURCE_PARSER_VERSION,
  type CsvMapping,
  type SourceTransaction,
} from "./source-csv";
export type SourceRecoveryPlan = {
  version: 1;
  parser: string;
  filename: string;
  mapping: CsvMapping;
  row_count: number;
  incoming_pence: number;
  outgoing_pence: number;
  coverage_start: string;
  coverage_end: string;
};
export type SourceAttempt = {
  id: string;
  user_id: string;
  account_id: string;
  file_hash: string;
  object_path: string;
  key_id: string;
  size_bytes: number;
  recovery_plan: SourceRecoveryPlan;
};
export type SourceRegistration = {
  import_id: string;
  created: boolean;
  transactions: number;
};
export type PreparedSourceRow = {
  row_number: number;
  date: string;
  description: string;
  reference: string;
  signed_pence: number;
  currency: string;
  row_hash: string;
  raw_encrypted: string;
  fingerprint: string;
};
export function sourcePlan(
  bytes: Uint8Array,
  mapping: CsvMapping,
  filename: string,
) {
  const table = readSourceCsv(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ),
    rows = normalizeSourceCsv(table, mapping);
  const index = (value: number) =>
    Number.isInteger(value) && value >= -1 && value < table[0].length
      ? value
      : -1;
  if (!rows.length) throw new Error("CSV has no transaction rows.");
  // Copy only recognised mapping fields; never persist arbitrary browser JSON properties.
  const confirmed: CsvMapping = {
    date: index(mapping.date),
    description: index(mapping.description),
    amount: index(mapping.amount),
    debit: index(mapping.debit),
    credit: index(mapping.credit),
    currency: index(mapping.currency),
    reference: index(mapping.reference),
    dateFormat: mapping.dateFormat,
    amountMode: mapping.amountMode,
  };
  const dates = rows.map((r) => r.date).sort();
  const plan: SourceRecoveryPlan = {
    version: 1,
    parser: SOURCE_PARSER_VERSION,
    filename: redactBankDetailsForPrompt(filename).slice(0, 200),
    mapping: confirmed,
    row_count: rows.length,
    incoming_pence: sumPence(
      rows.filter((r) => r.signedPence > 0).map((r) => r.signedPence),
    ),
    outgoing_pence: sumPence(
      rows.filter((r) => r.signedPence < 0).map((r) => -r.signedPence),
    ),
    coverage_start: dates[0],
    coverage_end: dates[dates.length - 1],
  };
  return { plan, rows };
}
export function prepareSourceRows(
  owner: string,
  account: string,
  hash: string,
  mapping: CsvMapping,
  rows: SourceTransaction[],
  key: Uint8Array,
): PreparedSourceRow[] {
  return rows.map((r) => {
    const raw = Buffer.from(JSON.stringify(r.rawCells));
    return {
      row_number: r.rowNumber,
      date: r.date,
      description: r.description,
      reference: r.reference,
      signed_pence: r.signedPence,
      currency: r.currency,
      row_hash: sourceHash(raw),
      raw_encrypted: encryptSource(
        raw,
        key,
        sourceContext(owner, account, hash, r.rowNumber),
      ).toString("base64"),
      fingerprint: sourceHash(
        Buffer.from(
          JSON.stringify([
            r.date,
            r.signedPence,
            r.currency,
            r.rawCells[mapping.description].trim().toLowerCase(),
            mapping.reference < 0
              ? ""
              : r.rawCells[mapping.reference].trim().toLowerCase(),
          ]),
        ),
      ),
    };
  });
}
export type SourceTransport = {
  createAttempt: (a: SourceAttempt) => Promise<void>;
  upload: (path: string, bytes: Buffer) => Promise<void>;
  transition: (
    id: string,
    owner: string,
    from: string[],
    to: string,
  ) => Promise<void>;
  register: (
    a: SourceAttempt,
    rows: PreparedSourceRow[],
  ) => Promise<SourceRegistration>;
};
export async function persistSourceCsv(
  input: {
    owner: string;
    account: string;
    bytes: Uint8Array;
    filename: string;
    mapping: CsvMapping;
  },
  key: Uint8Array,
  keyId: string,
  transport: SourceTransport,
) {
  const { plan, rows } = sourcePlan(input.bytes, input.mapping, input.filename),
    id = randomUUID(),
    hash = sourceHash(input.bytes);
  const attempt: SourceAttempt = {
    id,
    user_id: input.owner,
    account_id: input.account,
    file_hash: hash,
    object_path: `${input.owner}/${input.account}/${id}.enc`,
    key_id: keyId,
    size_bytes: input.bytes.length,
    recovery_plan: plan,
  };
  await transport.createAttempt(attempt);
  try {
    await transport.upload(
      attempt.object_path,
      encryptSource(
        input.bytes,
        key,
        sourceContext(input.owner, input.account, hash),
      ),
    );
    await transport.transition(id, input.owner, ["pending"], "uploaded");
    return await transport.register(
      attempt,
      prepareSourceRows(
        input.owner,
        input.account,
        hash,
        plan.mapping,
        rows,
        key,
      ),
    );
  } catch (error) {
    await transport
      .transition(id, input.owner, ["pending", "uploaded"], "failed")
      .catch(() => {});
    throw error;
  }
}
