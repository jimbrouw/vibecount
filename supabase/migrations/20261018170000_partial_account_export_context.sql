-- Read-only consistency context for the explicitly scoped partial account export.
-- No table/row/financial/history mutation and no secret/path/snapshot projection.
create function public.read_partial_account_export_context() returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to export account data.';end if;
 with settings as (select coalesce(jsonb_agg(to_jsonb(projection) order by projection.id),'[]'::jsonb) rows from (select id,legal_name,address,contact_details,default_payment_terms,payment_link_provider,payment_link_url,vat_registered,vat_number,vat_rate,invoice_number_prefix,late_payment_wording,pdf_primary_color,pdf_accent_color,tax_pot_percentage,statutory_interest_rate,created_at,updated_at from public.user_settings where id=(select auth.uid())) projection),
 clients as (select coalesce(jsonb_agg(to_jsonb(projection) order by projection.id),'[]'::jsonb) rows from (select id,user_id,name,email,address,company_number,vat_number,created_at,updated_at from public.clients where user_id=(select auth.uid())) projection),
 invoices as (select coalesce(jsonb_agg(to_jsonb(projection) order by projection.id),'[]'::jsonb) rows from (select id,user_id,client_id,project_id,number,invoice_date,due_date,description,amount,currency,origin,original_total_minor,currency_ruleset_id,source_fact_revision_id,source_fact_family_id,payment_terms,status,finalised_at,sent_at,paid_at,delivery_status,reminder_enabled,next_reminder_at,net_pence,vat_pence,vat_rate_bps,vat_enabled,vat_number_snapshot,economics_version,created_at,updated_at from public.invoices where user_id=(select auth.uid())) projection),
 financialrecords as (select coalesce(jsonb_agg(to_jsonb(projection) order by projection.id),'[]'::jsonb) rows from (select id,user_id,record_type,record_date,description,amount,effect_sign,category_id,client_id,invoice_id,project_id,import_id,source_type,status,tax_year_start,tax_quarter,approved_at,bank_transaction_id,refund_link_id,csv_import_row_id,bank_statement_row_id,created_at,updated_at from public.financial_records where user_id=(select auth.uid())) projection),
 invoicereminders as (select coalesce(jsonb_agg(to_jsonb(projection) order by projection.id),'[]'::jsonb) rows from (select id,user_id,invoice_id,client_id,recipient_email,status,balance_updated_at,amount_due_pence,sent_at,created_at,updated_at from public.invoice_reminders where user_id=(select auth.uid())) projection),
 invoicerevisions as (select coalesce(jsonb_agg(to_jsonb(projection) order by projection.id),'[]'::jsonb) rows from (select id,user_id,invoice_id,version,origin,source_fact_revision_id,pdf_sha256,author,created_at from public.invoice_revisions where user_id=(select auth.uid())) projection)
 select jsonb_build_object('schema_version','vibecount.partial-account-context/1','owner_id',auth.uid(),
 'stamp',encode(sha256(convert_to(jsonb_build_object('contract','vibecount.partial-account/2','data',jsonb_build_object('settings',settings.rows,'clients',clients.rows,'invoices',invoices.rows,'financialRecords',financialrecords.rows,'invoiceReminders',invoicereminders.rows,'invoiceRevisions',invoicerevisions.rows))::text,'UTF8')),'hex'),
 'counts',jsonb_build_object('settings',jsonb_array_length(settings.rows),'clients',jsonb_array_length(clients.rows),'invoices',jsonb_array_length(invoices.rows),'financialRecords',jsonb_array_length(financialrecords.rows),'invoiceReminders',jsonb_array_length(invoicereminders.rows),'invoiceRevisions',jsonb_array_length(invoicerevisions.rows))) into result
 from settings,clients,invoices,financialrecords,invoicereminders,invoicerevisions;
 return result;
end;$$;
revoke all on function public.read_partial_account_export_context() from public,anon,authenticated,service_role;
grant execute on function public.read_partial_account_export_context() to authenticated;
