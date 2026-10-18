# Synthetic document evidence

These are generated test/demo PDFs with no real personal identifiers or financial records. `synthetic-invoices.zip` contains the two individual invoice PDFs (£250 and £275); `employment.pdf` contains illustrative pay/tax figures from the handover, explicitly marked unverified synthetic inputs.

Use `/dashboard/imports` to preserve the archive with Invoice purpose and the employment PDF with Employment purpose for 2025/26. Reupload the same files with the same purpose/year: the canonical batch must be reused. Inspect file hashes and export the document manifest. No receipt, expense, paid invoice or verified PAYE fact should appear merely from uploading these files.

These fixtures test preservation; invoice extraction, matching, employment-fact review and the tax calculation are separate workflows still to implement.
