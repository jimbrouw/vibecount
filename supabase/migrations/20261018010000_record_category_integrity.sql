-- Additive protection for legacy mutable links. Do not rewrite historical decisions.
create function public.guard_record_category_identity() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.id is distinct from old.id or new.user_id is distinct from old.user_id
    or new.record_type is distinct from old.record_type or new.is_default is distinct from old.is_default then
  raise exception 'Category identity is immutable. Create a new category and review reassignment.';
 end if;
 return new;
end;$$;
revoke all on function public.guard_record_category_identity() from public,anon,authenticated,service_role;
create trigger record_categories_identity_guard before update on public.record_categories
for each row execute function public.guard_record_category_identity();

create function public.guard_owned_record_category() returns trigger
language plpgsql security definer set search_path='' as $$
declare category public.record_categories;
begin
 if new.category_id is null then return new;end if;
 -- Definer lookup avoids FOR KEY SHARE hiding shared defaults through UPDATE RLS.
 -- Category ownership/type cannot mutate; the key lock also protects deletion.
 select * into category from public.record_categories where id=new.category_id for key share;
 if not found or category.record_type is distinct from new.record_type
    or not (category.user_id=new.user_id or (category.user_id is null and category.is_default)) then
  raise exception 'Category must belong to this user or be a shared default of the same record type.';
 end if;
 return new;
end;$$;
revoke all on function public.guard_owned_record_category() from public,anon,authenticated,service_role;
create trigger financial_records_owned_category before insert or update on public.financial_records
for each row execute function public.guard_owned_record_category();
create trigger csv_import_rows_owned_category before insert or update on public.csv_import_rows
for each row execute function public.guard_owned_record_category();
create trigger bank_statement_import_rows_owned_category before insert or update on public.bank_statement_import_rows
for each row execute function public.guard_owned_record_category();

-- Safe diagnostics: no foreign category metadata, private evidence, or guessed repair.
create view public.record_category_integrity_issues with(security_invoker=true) as
select 'financial_record'::text source_kind,r.id,r.user_id,r.record_type,r.status,r.updated_at
from public.financial_records r where r.category_id is not null and not exists(
 select 1 from public.record_categories c where c.id=r.category_id and c.record_type=r.record_type
 and (c.user_id=r.user_id or(c.user_id is null and c.is_default)))
union all
select 'csv_staging',r.id,r.user_id,r.record_type,r.status,r.updated_at
from public.csv_import_rows r where r.category_id is not null and not exists(
 select 1 from public.record_categories c where c.id=r.category_id and c.record_type=r.record_type
 and (c.user_id=r.user_id or(c.user_id is null and c.is_default)))
union all
select 'pdf_staging',r.id,r.user_id,r.record_type,r.status,r.updated_at
from public.bank_statement_import_rows r where r.category_id is not null and not exists(
 select 1 from public.record_categories c where c.id=r.category_id and c.record_type=r.record_type
 and (c.user_id=r.user_id or(c.user_id is null and c.is_default)));
revoke all on public.record_category_integrity_issues from public,anon,authenticated,service_role;
grant select on public.record_category_integrity_issues to authenticated;
