export const EXTRACTION_MODEL =
  process.env.VIBECOUNT_EXTRACTION_MODEL || "claude-sonnet-4-20250514";

export const SYSTEM_PROMPT = `You are a financial data extraction agent for a UK invoicing app used by people who may be dyslexic or dyscalculic. Your job is to turn a spoken transcript into structured JSON. Getting an amount WRONG is far worse than admitting it is unclear.

Extract these fields:
1. "client" (string): who is being invoiced.
2. "description" (string): the service or item. Keep it concise.
3. "amount" (float): your best single reading of the amount in GBP, two decimals.
4. "amount_ambiguous" (boolean): true if the spoken amount has more than one defensible monetary reading.
5. "amount_candidates" (array of floats): if ambiguous, the plausible readings (most likely first). Empty array if not ambiguous.

AMOUNT RULES (UK ENGLISH):
- Treat an amount as EXACT (amount_ambiguous=false) when wording fixes the structure:
  - explicit units: "X pounds", "X pounds Y pence", "X quid", "X point Y", "X dot Y"
  - magnitude words: "X grand"=Xx1000, "X k"=Xx1000, "X hundred", "X thousand"
  - slang with one standard value: "a grand"=1000, "a ton"=100, "a monkey"=500, "a pony"=25
  - "eight pounds fifty" = 8.50 (the word "pounds" anchors the decimal)
- Treat an amount as AMBIGUOUS (amount_ambiguous=true) when it is a bare run of number-words with NO unit or decimal anchor, because it could be pounds-and-pence OR a larger whole number. Examples:
  - "eight fifty" -> could be 8.50 or 850.00
  - "three fifty" -> could be 3.50 or 350.00
  - "twenty two fifty" -> could be 22.50 or 2250.00
  - "one twenty five" -> could be 1.25 or 125.00
  - a spoken digit string like "eleven nine nine nine" -> could group several ways (e.g. 11999, 1199.90)
  In these cases still give your best "amount", but set amount_ambiguous=true and list the readings in amount_candidates.

OUTPUT FORMAT:
Return ONLY raw valid JSON. No markdown, no code fences, no commentary before or after.

EXAMPLE (clear):
{"client":"Simon","description":"projection mapping","amount":850.00,"amount_ambiguous":false,"amount_candidates":[]}

EXAMPLE (ambiguous):
{"client":"the Burns Trust","description":"mausoleum mapping","amount":850.00,"amount_ambiguous":true,"amount_candidates":[850.00,8.50]}`;

export type VoiceDraft = {
  client: string;
  description: string;
  amount: number;
  amount_ambiguous: boolean;
  amount_candidates: number[];
};

export function parseVoiceDraft(rawText: string): VoiceDraft | null {
  try {
    const trimmed = rawText.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const start = trimmed.indexOf("{");
    const source = start >= 0 ? trimmed.slice(start) : trimmed;
    const parsed = JSON.parse(source) as Partial<VoiceDraft>;

    const amount = Number(parsed.amount);
    const candidates = Array.isArray(parsed.amount_candidates)
      ? parsed.amount_candidates
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      : [];

    if (
      typeof parsed.client !== "string" ||
      typeof parsed.description !== "string" ||
      !Number.isFinite(amount)
    ) {
      return null;
    }

    return {
      client: parsed.client.trim(),
      description: parsed.description.trim(),
      amount: Math.round(amount * 100) / 100,
      amount_ambiguous: Boolean(parsed.amount_ambiguous),
      amount_candidates: candidates,
    };
  } catch {
    return null;
  }
}
