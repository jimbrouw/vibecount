-- UK tax year runs 6 Apr to 5 Apr the following year.
-- tax_year_start = year in which the tax year begins (e.g. 2025 for 2025/26).
-- tax_quarter:
--   Q1 = 6 Apr – 5 Jul
--   Q2 = 6 Jul – 5 Oct
--   Q3 = 6 Oct – 5 Jan
--   Q4 = 6 Jan – 5 Apr

CREATE TABLE public.financial_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  record_type text NOT NULL CHECK (record_type IN ('income', 'expense')),
  record_date date NOT NULL DEFAULT current_date,
  amount_pence bigint NOT NULL CHECK (amount_pence > 0),
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  category text NOT NULL DEFAULT 'Uncategorised',
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual', 'csv_import', 'bank_import', 'invoice')),
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  receipt_url text,
  -- GENERATED: year the current tax year started (e.g. 2025 for any date 6 Apr 2025 – 5 Apr 2026)
  tax_year_start int GENERATED ALWAYS AS (
    CASE
      WHEN EXTRACT(MONTH FROM record_date) > 4 THEN EXTRACT(YEAR FROM record_date)::int
      WHEN EXTRACT(MONTH FROM record_date) = 4 AND EXTRACT(DAY FROM record_date) >= 6
        THEN EXTRACT(YEAR FROM record_date)::int
      ELSE EXTRACT(YEAR FROM record_date)::int - 1
    END
  ) STORED,
  -- GENERATED: HMRC quarter (1–4) within the tax year
  tax_quarter int GENERATED ALWAYS AS (
    CASE
      -- Q1: 6 Apr – 5 Jul
      WHEN (
        EXTRACT(MONTH FROM record_date) = 4 AND EXTRACT(DAY FROM record_date) >= 6
        OR EXTRACT(MONTH FROM record_date) = 5
        OR EXTRACT(MONTH FROM record_date) = 6
        OR (EXTRACT(MONTH FROM record_date) = 7 AND EXTRACT(DAY FROM record_date) < 6)
      ) THEN 1
      -- Q2: 6 Jul – 5 Oct
      WHEN (
        (EXTRACT(MONTH FROM record_date) = 7 AND EXTRACT(DAY FROM record_date) >= 6)
        OR EXTRACT(MONTH FROM record_date) = 8
        OR EXTRACT(MONTH FROM record_date) = 9
        OR (EXTRACT(MONTH FROM record_date) = 10 AND EXTRACT(DAY FROM record_date) < 6)
      ) THEN 2
      -- Q3: 6 Oct – 5 Jan
      WHEN (
        (EXTRACT(MONTH FROM record_date) = 10 AND EXTRACT(DAY FROM record_date) >= 6)
        OR EXTRACT(MONTH FROM record_date) = 11
        OR EXTRACT(MONTH FROM record_date) = 12
        OR (EXTRACT(MONTH FROM record_date) = 1 AND EXTRACT(DAY FROM record_date) < 6)
      ) THEN 3
      -- Q4: 6 Jan – 5 Apr
      ELSE 4
    END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.financial_records (user_id, record_date DESC);
CREATE INDEX ON public.financial_records (user_id, tax_year_start, tax_quarter);

ALTER TABLE public.financial_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own their financial records"
  ON public.financial_records
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE TRIGGER set_financial_records_updated_at
  BEFORE UPDATE ON public.financial_records
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Import staging table: CSV and bank statement rows pending user review
CREATE TABLE public.record_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  import_date date NOT NULL,
  amount_pence bigint NOT NULL,
  description text NOT NULL,
  suggested_category text,
  record_type text NOT NULL CHECK (record_type IN ('income', 'expense')),
  source text NOT NULL CHECK (source IN ('csv_import', 'bank_import')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  -- set when approved; FK to the committed financial_records row
  committed_record_id uuid REFERENCES public.financial_records(id) ON DELETE SET NULL,
  -- original parsed row for audit; never contains raw account numbers
  raw_row jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.record_imports (user_id, status, created_at DESC);

ALTER TABLE public.record_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own their record imports"
  ON public.record_imports
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
