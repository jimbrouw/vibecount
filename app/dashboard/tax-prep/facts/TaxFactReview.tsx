"use client";
import { useState } from "react";
import { formatPounds, signedAmountToWords } from "@/lib/invoices/money";
import {
  emptyProfile,
  profileFields,
  factFields,
  parseFactInputs,
  validateProfile,
  type FactKind,
  type ProfileData,
  type TaxFact,
  type TaxProfileRevision,
} from "@/lib/tax/facts";
import { reviewTaxInputs } from "./actions";
const control = "block w-full rounded border p-2";
const money = (n: number) => `${formatPounds(n)} (${signedAmountToWords(n)})`;
const pretty = (s: string) => s.replaceAll("_", " ");
export type TaxSourceChoice = { id: string; label: string };
export type SourceSelection = {
  document_ids: string[];
  transaction_ids: string[];
  record_ids: string[];
};
type Shared = { year: number; stamp: string; requestId: string };
function Scope({ year, stamp, requestId }: Shared) {
  return (
    <>
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="stamp" value={stamp} />
      <input type="hidden" name="requestId" value={requestId} />
    </>
  );
}
function Confirm({
  confirmed,
  setConfirmed,
  disabled = false,
  text,
}: {
  confirmed: boolean;
  setConfirmed: (b: boolean) => void;
  disabled?: boolean;
  text: string;
}) {
  return (
    <div onChange={(e) => e.stopPropagation()}>
      <label className="block">
        <input
          type="checkbox"
          required
          name="humanConfirmed"
          value="yes"
          checked={confirmed}
          disabled={disabled}
          onChange={(e) => setConfirmed(e.target.checked)}
          data-testid="tax-fact-confirm"
        />{" "}
        {text}
      </label>
      <button
        disabled={!confirmed || disabled}
        data-testid="tax-fact-submit"
        className="mt-3 rounded border p-2"
      >
        Confirm reviewed input
      </button>
    </div>
  );
}
const profileLabels: Record<keyof ProfileData, string> = {
  jurisdiction: "Income Tax jurisdiction",
  accounting_basis:
    "Accounting basis (received/paid cash or invoice/bill dates)",
  business_structure: "Business structure",
  vat_registered: "VAT registered",
  student_loan: "Student or postgraduate loan plan",
  residency: "UK residence for the whole tax year",
  special_reliefs:
    "Other tax circumstances: child benefit, marriage/blind allowances, capital gains, losses, transition profits, artist averaging, foreign income, pension charges or other special reliefs",
  ledger_completeness: "Trading ledger collection reviewed for this year",
};
export function TaxProfileReview(
  props: Shared & { profile?: TaxProfileRevision },
) {
  return <ProfileForm key={JSON.stringify(props)} {...props} />;
}
function ProfileForm({
  profile,
  ...scope
}: Parameters<typeof TaxProfileReview>[0]) {
  const [data, setData] = useState<ProfileData>(
      profile?.data ?? emptyProfile(),
    ),
    [state, setState] = useState(profile?.state ?? "provisional"),
    [confirmed, confirm] = useState(false);
  let problem = "";
  try {
    validateProfile(data, state === "reviewed");
  } catch (e) {
    problem = e instanceof Error ? e.message : "Review profile";
  }
  return (
    <form
      action={reviewTaxInputs}
      data-testid="tax-profile-form"
      className="space-y-3 rounded border p-4"
      onChange={() => confirm(false)}
    >
      <Scope {...scope} />
      <input
        type="hidden"
        name="review"
        value={JSON.stringify({
          action: "profile",
          expected_ordinal: profile?.ordinal ?? 0,
          state,
          data,
        })}
      />
      <h2 className="text-xl font-semibold">Tax-year profile</h2>
      <p>
        Unknown is a valid provisional answer. It cannot establish a complete
        calculation. Partnership, company, VAT, residence and special cases must
        be handled explicitly by the later rules engine.
      </p>
      {Object.entries(profileFields).map(([key, options]) => (
        <label className="block" key={key}>
          {profileLabels[key as keyof ProfileData]}
          <select
            className={control}
            value={data[key as keyof ProfileData]}
            data-testid={`tax-profile-${key}`}
            onChange={(e) => setData({ ...data, [key]: e.target.value })}
          >
            {options.map((o) => (
              <option key={o} value={o}>
                {pretty(o)}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="block">
        Profile review state
        <select
          className={control}
          data-testid="tax-profile-state"
          value={state}
          onChange={(e) =>
            setState(e.target.value as "reviewed" | "provisional")
          }
        >
          <option value="provisional">Provisional</option>
          <option value="reviewed">Reviewed answers</option>
        </select>
      </label>
      <div data-testid="tax-profile-readback">
        <p>
          Tax year {scope.year}/{String(scope.year + 1).slice(2)} · {state}.{" "}
          {Object.entries(data)
            .map(([k, v]) => `${pretty(k)}: ${pretty(v)}`)
            .join("; ")}
          .
        </p>
        <p>
          Saving creates {money(0)} of trading income or expenses. This is not a
          calculation, filing approval or tax certification.
        </p>
      </div>
      {problem && <p role="status">{problem}</p>}
      <label className="block">
        Reason for these profile answers
        <input
          name="reason"
          required
          maxLength={1000}
          className={control}
          data-testid="tax-profile-reason"
        />
      </label>
      <Confirm
        confirmed={confirmed}
        setConfirmed={confirm}
        disabled={!!problem}
        text="I reviewed these tax-year answers and their unresolved states."
      />
    </form>
  );
}
function inputValues(fact?: TaxFact) {
  if (!fact) return {};
  return Object.fromEntries(
    factFields[fact.kind].map((f) => {
      const v = fact.data[f.key];
      if (v == null) return [f.key, ""];
      if (["money", "signed_money", "percent", "miles"].includes(f.type)) {
        const n = Number(v),
          abs = Math.abs(n);
        return [
          f.key,
          `${n < 0 ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`,
        ];
      }
      return [f.key, String(v)];
    }),
  );
}
export function TaxFactReview(
  props: Shared & {
    kind: FactKind;
    fact?: TaxFact;
    selected: SourceSelection;
    documents: TaxSourceChoice[];
    transactions: TaxSourceChoice[];
    records: TaxSourceChoice[];
  },
) {
  return <FactForm key={JSON.stringify(props)} {...props} />;
}
function FactForm({
  kind,
  fact,
  selected,
  documents,
  transactions,
  records,
  ...scope
}: Parameters<typeof TaxFactReview>[0]) {
  const [values, setValues] = useState<Record<string, string>>(
      inputValues(fact),
    ),
    [label, setLabel] = useState(fact?.label ?? ""),
    [state, setState] = useState(fact?.state ?? "provisional"),
    [sources, setSources] = useState(selected),
    [confirmed, confirm] = useState(false);
  let data: Record<string, string | number | null> | undefined,
    problem = "";
  try {
    data = parseFactInputs(kind, values, scope.year, state);
    if (!label.trim())
      throw new Error(
        "Give this distinct employment, asset, payment or fact a safe identity label.",
      );
    if (
      state === "verified" &&
      (!Object.values(sources).some((ids) => ids.length) ||
        ((["employment", "termination", "pension"].includes(kind) ||
          (kind === "vehicle" && data?.method === "simplified_mileage")) &&
          sources.document_ids.length === 0))
    )
      throw new Error(
        "Verified values need source evidence; employment, termination and pensions need documents.",
      );
  } catch (e) {
    problem = e instanceof Error ? e.message : "Review typed values.";
  }
  const review = {
    action: "fact",
    kind,
    label,
    family_id: fact?.family_id ?? null,
    expected_ordinal: fact?.ordinal ?? 0,
    state,
    data,
    ...sources,
  };
  return (
    <form
      action={reviewTaxInputs}
      data-testid="tax-input-form"
      className="space-y-3 rounded border p-4"
      onChange={() => confirm(false)}
    >
      <Scope {...scope} />
      <input type="hidden" name="review" value={JSON.stringify(review)} />
      <h2 className="text-xl font-semibold">
        {fact ? "Revise" : "Add"} {pretty(kind)} fact
      </h2>
      <p>
        Enter values from evidence you have reviewed yourself. Preserved
        documents remain opaque; no raw document is sent to an AI service.
        Verified means you checked these typed values, not that VibeCount
        certifies their tax treatment.
      </p>
      {kind === "employment" && (
        <p>
          Use one family per employment. Revise a cumulative P45/P60 total for
          the same job rather than creating another employment. National
          Insurance withheld is not PAYE Income Tax. Leave the NICable-band
          field unknown unless you have its separate evidence.
        </p>
      )}
      {kind === "termination" && (
        <p>
          Review the settlement breakdown. Notice pay, holiday pay and other
          employment pay may be taxable. Do not repeat taxable pay or
          withholding already included in an employment fact. The handover
          redundancy amount is not automatically exempt.
        </p>
      )}
      {kind === "pension" && (
        <p>
          Record contributions paid in this tax year, not pension savings,
          employer promises or next-year forecasts. Net pay and salary sacrifice
          must not receive the same relief twice. Contributions are never
          trading expenses.
        </p>
      )}
      {kind === "tax_payment" && (
        <p>
          Record actual paid tax and its explicit liability-year allocation. A
          tax reserve or savings balance is not a payment credit. Reuse the same
          safe payment identity for splits of one physical payment; select its
          single bank observation when available.
        </p>
      )}
      {kind === "vehicle" && (
        <p>
          Use one stable label per vehicle. Link every relevant actual-cost
          record. Mileage and actual costs must not both be claimed for the same
          vehicle; later calculations must substitute the elected method.
          Sole-trader bicycles and e-bikes do not use employee bicycle mileage
          rates.
        </p>
      )}
      <label className="block">
        Safe identity label (no tax IDs or account numbers)
        <input
          className={control}
          value={label}
          disabled={!!fact}
          required
          maxLength={120}
          data-testid="tax-input-label"
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      {factFields[kind].map((f) => (
        <label key={f.key} className="block">
          {f.label}
          {f.optional ? " · unknown if blank" : ""}
          {f.type === "select" ? (
            <select
              className={control}
              disabled={state === "withdrawn"}
              value={values[f.key] ?? ""}
              data-testid={`tax-input-${f.key}`}
              onChange={(e) =>
                setValues({ ...values, [f.key]: e.target.value })
              }
            >
              <option value="">Choose explicitly</option>
              {f.options?.map((o) => (
                <option key={o} value={o}>
                  {pretty(o)}
                </option>
              ))}
            </select>
          ) : (
            <input
              className={control}
              disabled={state === "withdrawn"}
              type={f.type === "date" ? "date" : "text"}
              inputMode={
                ["money", "signed_money", "percent", "miles"].includes(f.type)
                  ? "decimal"
                  : undefined
              }
              required={!f.optional}
              maxLength={f.type === "text" ? 120 : undefined}
              value={values[f.key] ?? ""}
              data-testid={`tax-input-${f.key}`}
              onChange={(e) =>
                setValues({ ...values, [f.key]: e.target.value })
              }
            />
          )}
        </label>
      ))}
      <label className="block">
        Fact review state
        <select
          className={control}
          value={state}
          data-testid="tax-input-state"
          onChange={(e) => {
            setState(e.target.value as TaxFact["state"]);
            if (e.target.value === "withdrawn") {
              setValues(inputValues(fact));
              setSources(selected);
            }
          }}
        >
          <option value="provisional">Provisional — unresolved</option>
          <option value="verified">Verified against selected evidence</option>
          <option value="excluded">Excluded — retain evidence</option>
          {fact && (
            <option value="withdrawn">
              Withdraw this current fact — restore no older value
            </option>
          )}
        </select>
      </label>
      {(
        [
          ["document_ids", "Preserved documents", documents],
          ["transaction_ids", "Normalized bank observations", transactions],
          ["record_ids", "Approved trading records", records],
        ] as const
      ).map(([key, title, choices]) => (
        <label key={key} className="block">
          {title} on this page (up to 50; use Control/Command to select
          multiple)
          <select
            className={control}
            multiple
            disabled={state === "withdrawn"}
            data-testid={`tax-input-${key}`}
            value={sources[key]}
            onChange={(e) =>
              setSources({
                ...sources,
                [key]: Array.from(e.target.selectedOptions, (o) => o.value),
              })
            }
          >
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <div data-testid="tax-input-readback">
        <h3 className="font-semibold">Review exact values and source scope</h3>
        <p>
          {pretty(kind)} · {label || "identity missing"} · {state} · tax year
          starting {scope.year}.
        </p>
        {data &&
          factFields[kind].map((f) => (
            <p key={f.key}>
              {f.label}:{" "}
              {data![f.key] == null
                ? "Unknown"
                : ["money", "signed_money"].includes(f.type)
                  ? money(Number(data![f.key]))
                  : f.type === "percent"
                    ? `${Number(data![f.key]) / 100}%`
                    : f.type === "miles"
                      ? `${Number(data![f.key]) / 100} miles`
                      : pretty(String(data![f.key]))}
            </p>
          ))}
        <p>
          {sources.document_ids.length} documents;{" "}
          {sources.transaction_ids.length} bank observations;{" "}
          {sources.record_ids.length} trading records. Saving creates {money(0)}{" "}
          of trading income or expenses.{" "}
          {state === "withdrawn"
            ? "Current fact is removed from future inputs. Earlier approved values are not restored."
            : "No deduction, exemption, tax credit or filing is automatically committed."}
        </p>
      </div>
      {problem && <p role="status">{problem}</p>}
      <label className="block">
        Evidence review, business-use rationale and correction reason
        <input
          className={control}
          name="reason"
          required
          maxLength={1000}
          data-testid="tax-input-reason"
        />
      </label>
      <Confirm
        confirmed={confirmed}
        setConfirmed={confirm}
        disabled={!!problem}
        text="I read back every value, tax year, status and selected source and confirm this input revision."
      />
    </form>
  );
}
export function TaxSectionReview(
  props: Shared & {
    kind: FactKind;
    activeCount: number;
    provisionalCount: number;
  },
) {
  return <SectionForm key={JSON.stringify(props)} {...props} />;
}
function SectionForm({
  kind,
  activeCount,
  provisionalCount,
  ...scope
}: Parameters<typeof TaxSectionReview>[0]) {
  const [verdict, setVerdict] = useState(""),
    [confirmed, confirm] = useState(false);
  const valid =
    verdict === "none"
      ? activeCount === 0
      : verdict === "complete" && activeCount > 0 && provisionalCount === 0;
  return (
    <form
      action={reviewTaxInputs}
      data-testid="tax-section-form"
      className="space-y-3 rounded border p-4"
      onChange={() => confirm(false)}
    >
      <Scope {...scope} />
      <input
        type="hidden"
        name="review"
        value={JSON.stringify({ action: "section", kind, verdict })}
      />
      <h2 className="text-xl font-semibold">
        Confirm {pretty(kind)} collection
      </h2>
      <p>
        {activeCount} active facts, {provisionalCount} provisional. This attests
        collection completeness, not calculation eligibility. Editing any fact
        invalidates this confirmation.
      </p>
      <label className="block">
        Collection answer
        <select
          className={control}
          value={verdict}
          data-testid="tax-section-verdict"
          onChange={(e) => setVerdict(e.target.value)}
        >
          <option value="">Not reviewed</option>
          <option value="none">None confirmed for this year</option>
          <option value="complete">
            All facts for this section entered and reviewed
          </option>
        </select>
      </label>
      <p data-testid="tax-section-readback">
        Tax year starting {scope.year}: {pretty(kind)},{" "}
        {verdict ? pretty(verdict) : "unresolved"}.{" "}
        {verdict === "none"
          ? "You confirm there are no active facts for this section."
          : "All active facts and exclusions remain in the audit history."}{" "}
        This creates {money(0)} of trading income or expenses.
      </p>
      <label className="block">
        Completeness review reason
        <input
          name="reason"
          required
          maxLength={1000}
          className={control}
          data-testid="tax-section-reason"
        />
      </label>
      <Confirm
        confirmed={confirmed}
        setConfirmed={confirm}
        disabled={!valid}
        text="I checked all sources for this tax year and confirm this collection answer."
      />
    </form>
  );
}
