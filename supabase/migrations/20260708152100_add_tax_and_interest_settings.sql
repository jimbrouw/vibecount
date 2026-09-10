-- Add tax pot percentage and statutory interest rate to user_settings
alter table public.user_settings
add column tax_pot_percentage numeric(5, 2) not null default 27.00,
add column statutory_interest_rate numeric(5, 2) not null default 13.25;
