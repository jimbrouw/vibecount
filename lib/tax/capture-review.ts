import { prepareCalculation, verifySavedCalculation, type SavedCalculation } from './snapshot';
import type { CalculationInput } from './calculation';
export type CalculationReview = {
    year: number;
    request: string;
    reason: string;
    inputHash: string;
    resultHash: string;
    rulesHash: string;
};
type RulesRow = {
    id: string;
    canonical_json: string;
    sha256: string;
};
/** Recovery precedes live reads: a successful save remains recoverable after the ledger changes. */
export async function saveReviewedCalculation(review: CalculationReview, io: {
    recover: () => Promise<{
        row: SavedCalculation;
        rules: RulesRow;
    } | null>;
    read: () => Promise<CalculationInput>;
    capture: (prepared: ReturnType<typeof prepareCalculation>) => Promise<string>;
}) {
    const prior = await io.recover();
    if (prior) {
        verifySavedCalculation(prior.row, prior.rules);
        if (prior.row.tax_year_start !== review.year || prior.row.rationale !== review.reason || prior.row.input_sha256 !== review.inputHash || prior.row.result_sha256 !== review.resultHash || prior.rules.sha256 !== review.rulesHash)
            throw new Error('Review request already used with different inputs.');
        return prior.row.id;
    }
    const prepared = prepareCalculation(await io.read());
    if (prepared.input.tax_year_start !== review.year || prepared.inputHash !== review.inputHash || prepared.resultHash !== review.resultHash || prepared.rulesHash !== review.rulesHash)
        throw new Error('Calculation changed. Review the current draft again.');
    return io.capture(prepared);
}
