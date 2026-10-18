# Verified original evidence downloads

Supporting documents preserved through document intake can now be downloaded from Imports → Preserved document evidence. Each document has an explicit private-download checkbox and button. The page continues to show safe metadata only; originals are not embedded in browser-agent review surfaces, prompts, tax inputs or filing manifests. Downloading does not approve any financial fact.

The POST route `/api/evidence/documents/[documentId]/original` authenticates the session, checks the same Origin, validates a bounded URL-encoded confirmation and passes the authenticated owner to the private store. It has no GET download handler. The privileged metadata query filters both document ID and owner, and the model independently checks those identities and the owner-prefixed immutable object path.

The store retrieves ciphertext from the private document-evidence bucket and uses the document's recorded key ID. It reuses recovery's authenticated-decryption, exact-size and SHA-256 checks. Unknown keys, missing objects, wrong context, altered ciphertext/hash/size or an unavailable audit table return no file. Keys are cleared after use. The response uses a generated filename, attachment disposition, private/no-store caching, nosniff and a restrictive sandbox policy. Original encrypted filenames and object/key metadata are not returned.

Migration `20261020010000_document_original_access.sql` adds owner-readable, service-insertable access history. The event is `download_prepared`: it proves that verified bytes were prepared for an authenticated request, not that the browser saved the file or a human read it. The event must be recorded before the response is constructed. Exposed roles cannot rewrite or delete the history, and the composite foreign key prevents linking another owner's document.

## Local verification

Run:

```sh
npx tsx --test lib/database/document-original-access.test.ts lib/records/document-original.test.ts lib/records/source-original.test.ts lib/records/evidence-recovery.test.ts
```

Nine checks cover recorded-key recovery, ownership, tampering, unavailable ciphertext, audit failure, explicit same-origin confirmation, private response headers and SQL roles/history. The original-byte test encrypts and recovers `fixtures/document-evidence/invoice-one.pdf`, verifies exact byte equality and opens the recovered PDF with the existing PDF parser. TypeScript, focused lint and the clean-cache production build pass.

For a manual demonstration on a designated test installation with the migration and retained encryption keys, upload the synthetic invoice PDF via Imports, expand its batch, confirm the private download and open the returned PDF locally. Compare its SHA-256 with the displayed manifest. No financial entry or reviewed fact should be created. This manual hosted demonstration has not been performed.

## Remaining acceptance

The document route covers registered PDF, PNG, JPEG and ZIP supporting documents. The separate bank route below handles preserved source CSVs. Retention/deletion, coordinated key/object/database restore and hosted Auth/Storage acceptance remain open. Do not delete or rotate away retained keys based on this implementation. No hosted migration was applied.


## Preserved bank originals

`POST /api/imports/[importId]/original` shares the same bounded, authenticated, same-origin confirmation and attachment-response handler. Imports lists a private-download checkbox and button next to each preserved source hash. The private store reads the owned import and its recorded source file; the model independently verifies the owner, account, file ID, hash, byte limit and owner/account-prefixed object path. It decrypts with the recorded key and the existing source context `(owner, account, hash)`, then verifies exact bytes and records access before delivery.

Original bytes are preserved, including any untrusted spreadsheet expressions. The filename ends in `.csv.txt`, with application/octet-stream and attachment disposition; it is a private original for local review, not a sanitized spreadsheet export. The ordinary ledger export remains the spreadsheet-safe option. Raw bank content is not rendered in the Imports page, prompts or agent-facing review surfaces.

Migration `20261020020000_source_original_access.sql` adds owner-readable, service-insertable `download_prepared` history with owned-import and composite source/account/hash foreign keys. Exposed roles cannot update or delete the history. Recovery tests include an actual database source fixture and encrypted original, exact byte recovery, wrong account/file/hash/owner denial and cross-owner audit isolation. Discarding an import does not itself revoke access to its immutable original; no financial entry is added or approved by a download.

Neither migration was applied to a hosted service. An authenticated hosted original-download journey and actual coordinated restore are still required for acceptance.
