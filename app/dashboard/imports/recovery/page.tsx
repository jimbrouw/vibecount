import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import type { RecoveryChoice } from "@/lib/records/recovery-review";
import RecoveryReview from "./RecoveryReview";
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const db = await createClient();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect("/login");
  const params = await searchParams,
    historyAfter =
      typeof params.historyAfter === "string" && uuid.test(params.historyAfter)
        ? params.historyAfter
        : null,
    kind = params.kind === "document" ? "document" : "source",
    after =
      typeof params.after === "string" && uuid.test(params.after)
        ? params.after
        : null;
  let q = db
    .from("evidence_recovery_attempts")
    .select("*")
    .eq("user_id", user.id)
    .eq("kind", kind)
    .order("id")
    .limit(21);
  if (after) q = q.gt("id", after);
  const attempts = await q;
  let h = db
    .from("evidence_recovery_requests")
    .select(
      "request_id,kind,source_attempt_id,document_attempt_id,reason,verified_manifest_sha256,created_at",
    )
    .eq("user_id", user.id)
    .eq("kind", kind)
    .order("request_id")
    .limit(21);
  if (historyAfter) h = h.gt("request_id", historyAfter);
  const history = await h;
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-5">
      <header>
        <h1 className="text-2xl font-semibold">Evidence upload recovery</h1>
        <p>
          Inspect failed attempts and safely retry the original confirmed scope.
          Originals and raw document names remain private.
        </p>
        <Link
          href="/dashboard/imports"
          data-testid="recovery-imports-link"
          className="underline"
        >
          Imports and classification
        </Link>
      </header>
      <nav aria-label="Evidence attempt types" className="flex gap-4">
        <Link
          href="/dashboard/imports/recovery?kind=source"
          data-testid="recovery-source-tab"
          aria-current={kind === "source" ? "page" : undefined}
        >
          CSV uploads
        </Link>
        <Link
          href="/dashboard/imports/recovery?kind=document"
          data-testid="recovery-document-tab"
          aria-current={kind === "document" ? "page" : undefined}
        >
          Document uploads
        </Link>
      </nav>
      {typeof params.error === "string" && (
        <p role="alert">{params.error.slice(0, 500)}</p>
      )}
      {params.result === "recovered" && (
        <p role="status">
          The verified original scope was registered or reused. Newly staged
          observations need classification; existing treatment is retained and
          document facts remain unverified.
        </p>
      )}
      {attempts.error || history.error ? (
        <p role="alert">
          Evidence recovery status is unavailable. Reload before retrying.
        </p>
      ) : (
        <>
          {!attempts.data?.length && (
            <p>
              No {kind === "source" ? "CSV" : "document"} attempts on this page.
            </p>
          )}
          {(attempts.data ?? []).slice(0, 20).map((row: RecoveryChoice) => (
            <section key={row.id} className="space-y-3 rounded border p-4">
              <h2 className="text-xl font-semibold">
                {row.created_at} · {row.state}
              </h2>
              <p className="break-all">
                Attempt {row.id} · SHA-256 {row.file_hash}
              </p>
              {row.destination_id ? (
                <Link
                  className="underline"
                  href={
                    row.kind === "source"
                      ? `/dashboard/imports?import=${row.destination_id}`
                      : `/api/evidence/${row.destination_id}/manifest`
                  }
                >
                  Review registered{" "}
                  {row.kind === "source" ? "source" : "document manifest"}
                </Link>
              ) : null}
              {row.state === "failed" ? (
                <RecoveryReview choice={row} requestId={randomUUID()} />
              ) : row.state === "pending" || row.state === "uploaded" ? (
                <p>
                  Original operation may still be running. It is not safe to
                  retry this attempt from its state alone. Preserve its ID for
                  operational investigation.
                </p>
              ) : (
                <p>
                  Registered attempt retained. Replaying it does not create
                  another source or restore financial approvals.
                </p>
              )}
            </section>
          ))}
          <nav aria-label="Upload attempt pages" className="flex gap-4">
            {after && (
              <Link href={`/dashboard/imports/recovery?kind=${kind}`}>
                First page
              </Link>
            )}
            {attempts.data && attempts.data.length > 20 && (
              <Link
                href={`/dashboard/imports/recovery?kind=${kind}&after=${attempts.data[19].id}`}
              >
                More attempts
              </Link>
            )}
          </nav>
          <section>
            <h2 className="text-xl font-semibold">Recovery confirmations</h2>
            <ul className="space-y-2">
              {history.data?.slice(0, 20).map((e) => (
                <li key={e.request_id} className="break-words">
                  {e.created_at} · Attempt{" "}
                  {e.source_attempt_id ?? e.document_attempt_id} · {e.reason} ·
                  Verified manifest SHA-256 {e.verified_manifest_sha256}
                </li>
              ))}
            </ul>
            <nav
              aria-label="Recovery confirmation pages"
              className="flex gap-4"
            >
              {historyAfter && (
                <Link href={`/dashboard/imports/recovery?kind=${kind}`}>
                  First confirmation page
                </Link>
              )}
              {history.data && history.data.length > 20 && (
                <Link
                  href={`/dashboard/imports/recovery?kind=${kind}&historyAfter=${history.data[19].request_id}`}
                >
                  More confirmations
                </Link>
              )}
            </nav>
          </section>
        </>
      )}
    </main>
  );
}
