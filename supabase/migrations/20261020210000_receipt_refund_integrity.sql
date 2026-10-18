-- Only the captured hosted receipt schema has this independent refund family.
-- Native bank refunds retain their existing reviewed allocation guards.
do $migration$
declare invalid boolean;
begin
 if exists(select 1 from information_schema.columns where table_schema='public' and table_name='financial_records' and column_name='refund_of') then
  execute $check$
   select exists(
    select 1 from public.financial_records r left join public.financial_records o on o.id=r.refund_of and o.user_id=r.user_id
    where r.status='approved' and r.expense_kind='refund' and
     (o.id is null or o.id=r.id or o.status<>'approved' or o.record_type<>'expense' or o.expense_kind<>'expense'
      or o.effect_sign<>1 or o.payment_status='unpaid' or o.currency<>'GBP'
      or r.record_type<>'expense' or r.payment_status<>'paid' or r.currency<>'GBP'
      or o.amount<(select sum(f.amount) from public.financial_records f where f.refund_of=o.id and f.user_id=o.user_id and f.status='approved' and f.expense_kind='refund'))
   )
  $check$ into invalid;
  if invalid then raise exception 'Existing receipt refunds require explicit review before this upgrade; original records have not been changed.';end if;
  execute $definition$
   create function public.guard_receipt_refund_integrity() returns trigger
   language plpgsql security definer set search_path='' as $body$
   declare original public.financial_records;other_refunds numeric;linked_refunds numeric;
   begin
    -- The UPDATE already holds this row lock. A concurrent refund insertion
    -- must acquire it before summing the remaining allocation.
    if tg_op='UPDATE' then
     select coalesce(sum(f.amount),0) into linked_refunds from public.financial_records f
      where f.refund_of=new.id and f.user_id=new.user_id and f.status='approved' and f.expense_kind='refund';
     if linked_refunds>0 and (new.status<>'approved' or new.record_type<>'expense'
      or new.expense_kind<>'expense' or new.effect_sign<>1 or new.payment_status='unpaid' or new.currency<>'GBP'
      or new.amount<linked_refunds) then
      raise exception 'Review linked refunds before reducing, excluding or unpaying the original expense.';
     end if;
    end if;
    if new.status='approved' and new.expense_kind='refund' then
     if new.refund_of is null or new.refund_of=new.id then raise exception 'Link refund to its original approved expense.';end if;
     select * into original from public.financial_records f where f.id=new.refund_of and f.user_id=new.user_id for update;
     if not found or original.status<>'approved' or original.record_type<>'expense' or original.expense_kind<>'expense'
      or original.effect_sign<>1 or original.payment_status='unpaid' or original.currency<>'GBP' or new.record_type<>'expense' or new.payment_status<>'paid' or new.currency<>'GBP'
      then raise exception 'Link refund to its original approved paid GBP expense.';end if;
     select coalesce(sum(f.amount),0) into other_refunds from public.financial_records f
      where f.refund_of=original.id and f.user_id=new.user_id and f.status='approved' and f.expense_kind='refund' and f.id<>new.id;
     if other_refunds+new.amount>original.amount then raise exception 'Refunds exceed the original expense.';end if;
    end if;
    return new;
   end;$body$;
  $definition$;
  execute 'revoke all on function public.guard_receipt_refund_integrity() from public,anon,authenticated,service_role';
  execute 'create trigger receipt_refund_integrity before insert or update on public.financial_records for each row execute function public.guard_receipt_refund_integrity()';
 end if;
end;$migration$;
