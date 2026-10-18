# Captured hosted migration metadata

Read-only capture from the existing `Vibecount` Supabase project (`lazorvlkgxgzdgflzhjm`), 18 October 2026. These four SQL files were returned by `supabase_migrations.schema_migrations`; they contain schema/function definitions, not customer rows or credentials. They were missing from this checkout's canonical migration directory.

| Hosted version | Name | MD5 of hosted statement array joined with newline |
| --- | --- | --- |
| 20261014113533 | receipt_document_import | 17ff23c1196185532c2ef9149795cff7 |
| 20261014113840 | receipt_audit_access | 2c60cac3510249b84e38b2a12159476e |
| 20261014114715 | receipt_evidence_allocation | ab8182c786efbfb5b88eb15b02d69bf5 |
| 20261014115320 | receipt_review_lock | a26a65a9fc416d88e603b3d124861757 |

Run `npx tsx scripts/rehearse-hosted-upgrade.ts` for a disposable local rehearsal: 24 common local predecessors, these four captured migrations, then the remaining local migrations. Existing paid, unpaid and refunded receipt records are represented by synthetic fixtures and checked for preservation. No command in that script connects to hosted services.

This does not prove the first 24 hosted statements are byte-identical to local predecessors, account for unrecorded hosted DDL, or certify receipt reporting semantics. Do not blindly copy these into an existing deployment or mark migration history repaired. Reconcile canonical history, validate legacy receipt reporting/approval integration, and rehearse a designated non-production database before deployment.
