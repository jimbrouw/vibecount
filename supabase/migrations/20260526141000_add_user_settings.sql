-- Migration to add user settings and seed high-quality glossary terms

create table public.user_settings (
  id uuid primary key references auth.users(id) on delete cascade,
  legal_name text not null default '',
  address text not null default '',
  contact_details text not null default '',
  default_payment_terms text not null default 'Payment due within 30 days',
  bank_details text not null default '',
  vat_registered boolean not null default false,
  vat_number text not null default '',
  vat_rate numeric(5, 2) not null default 20.00,
  invoice_number_prefix text not null default 'VC',
  late_payment_wording text not null default 'Late payments may be subject to statutory interest and compensation.',
  utr text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enable RLS on user_settings
alter table public.user_settings enable row level security;

-- Policies for user_settings
create policy "Users can read their own settings"
on public.user_settings
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Users can insert their own settings"
on public.user_settings
for insert
to authenticated
with check ((select auth.uid()) = id);

create policy "Users can update their own settings"
on public.user_settings
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Users can delete their own settings"
on public.user_settings
for delete
to authenticated
using ((select auth.uid()) = id);

-- Trigger for set_updated_at
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row
execute function public.set_updated_at();

-- Grant permissions
grant select, insert, update, delete on public.user_settings to authenticated;

-- Clear old placeholder rows from glossary_terms (since they were placeholders)
truncate table public.glossary_terms;

-- Seed rich, high-quality, accountant-reviewed glossary terms
insert into public.glossary_terms (term, explanation, example, sort_order)
values
  (
    'Self Assessment',
    'The annual process where you tell HM Revenue & Customs (HMRC) how much money you made as a self-employed freelancer, and pay the tax and National Insurance you owe on those earnings.',
    'You are a freelance graphic designer. By January 31st each year, you must submit a Self Assessment tax return online to show what you earned between April 6th of the previous year and April 5th of this year.',
    10
  ),
  (
    'Allowable Expenses',
    'Essential business costs that you pay specifically to run your freelance business. You subtract these from your total earnings (turnover) so you only pay tax on your actual profits.',
    'You bought a camera for £1,000 for your freelance photography work, and spent £200 on travel. These are allowable expenses, so if you made £10,000 in turnover, you only pay tax on £8,800 of profit.',
    20
  ),
  (
    'Payment on Account',
    'Advance payments towards your next self-employed tax bill. HMRC charges these twice a year to spread the tax cost out, based on a guess that you will earn the same as the previous year.',
    'Your tax bill for last year was £3,000. HMRC will automatically ask you to pay £1,500 by January 31st and another £1,500 by July 31st as advance payments for the upcoming year.',
    30
  ),
  (
    'Unique Taxpayer Reference',
    'A personal 10-digit number given to you by HMRC when you register as self-employed. It acts as your unique tax fingerprint and is required to log in or pay taxes.',
    'When you register for Self Assessment, HMRC sends a welcome letter containing your 10-digit UTR. You must quote this whenever you contact HMRC or make a tax payment.',
    40
  ),
  (
    'National Insurance',
    'A separate self-employed tax paid alongside your regular Income Tax. It builds your eligibility for state benefits, such as the State Pension and maternity allowances.',
    'As a freelancer, if your annual profits exceed the self-employed threshold, you will pay Class 4 National Insurance contributions (calculated as a percentage of your profit) through your Self Assessment return.',
    50
  ),
  (
    'Value Added Tax (VAT)',
    'A tax added to the price of most goods and services. If your business turnover goes above £90,000 in a 12-month period, you must register for VAT, charge it to clients, and pay it to HMRC.',
    'You are registered for VAT and invoice a client £1,000 for consulting. You must add 20% VAT (£200), bringing the total to £1,200. You collect that £200 and pay it to HMRC later.',
    60
  ),
  (
    'Turnover',
    'The total amount of money your business receives from clients before any expenses, taxes, or material costs are deducted.',
    'If you send 10 invoices of £1,000 each during the tax year and they are all paid, your turnover for that year is exactly £10,000, even if you spent £2,000 on tools.',
    70
  ),
  (
    'Profit',
    'The actual money your freelance business has made after you subtract all of your allowable business expenses from your total turnover.',
    'If your total turnover is £15,000 and your allowable business expenses (software, travel, office supplies) total £3,000, your taxable profit is £12,000.',
    80
  ),
  (
    'Accounts Payable',
    'The money that your freelance business owes to others, such as suppliers, subcontractors, or utility providers, for services or goods already received.',
    'You hired a freelance illustrator to draw a custom icon for a client project and they invoiced you £300 with 14-day terms. Until you pay them, that £300 is part of your accounts payable.',
    90
  ),
  (
    'Accounts Receivable',
    'The money that your clients owe you for services you have finished and invoiced, but have not yet received payment for.',
    'You sent a £1,500 invoice to a client for web design work with 30-day payment terms. Until the client transfers that £1,500 into your bank account, it is an accounts receivable.',
    100
  ),
  (
    'Flat Rate VAT Scheme',
    'An alternative way for small businesses to pay VAT. Instead of keeping track of VAT on every single purchase, you pay HMRC a fixed, lower percentage of your total VAT-inclusive turnover.',
    'Under the standard scheme, you pay VAT on sales minus VAT on purchases. Under the Flat Rate scheme, you might pay a flat 10% of your total sales to HMRC, simplifying your bookkeeping.',
    110
  ),
  (
    'Sole Trader',
    'The simplest business structure where you run your business as an individual. You are personally responsible for any business debts, and your business profits are taxed as personal income.',
    'You work as a freelance copywriter under your own name or a trading name. You are a sole trader, meaning there is no legal distinction between you and your business.',
    120
  ),
  (
    'HMRC',
    'His Majesty''s Revenue and Customs (HMRC) is the UK government department responsible for collecting taxes, administering tax laws, and paying state support.',
    'When you file your self-employed tax return, you submit it to HMRC, and you send your tax payments directly to HMRC''s bank accounts.',
    130
  );
