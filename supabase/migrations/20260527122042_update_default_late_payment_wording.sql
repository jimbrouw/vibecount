alter table public.user_settings
alter column late_payment_wording set default 'Payment is due within 30 days of the invoice date. We reserve the right to charge statutory interest at 8% above the Bank of England base rate, plus statutory debt recovery costs, under the Late Payment of Commercial Debts (Interest) Act 1998.';
