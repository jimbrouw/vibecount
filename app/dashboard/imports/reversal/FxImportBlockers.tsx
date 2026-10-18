import FxDependencyBlockers from '@/app/dashboard/reconciliation/FxDependencyBlockers';
import type { FxBlockedImportReview } from '@/lib/fx/dependency-review';
export default function FxImportBlockers({review:r}:{review:FxBlockedImportReview}){
 return <FxDependencyBlockers review={r} prefix="import-reversal" operation="Complete import reversal" selectedImportId={r.import_id}/>;
}
