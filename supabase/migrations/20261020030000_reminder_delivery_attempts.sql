-- A provider request is allowed only after an immutable, single-use claim.
-- Service RPCs are called only by authenticated server actions / the cron route.
alter table public.invoice_reminders add column from_email text;
alter table public.invoice_reminders add constraint invoice_reminders_id_owner unique(id,user_id);
alter table public.invoice_reminders drop constraint invoice_reminders_status_valid;
alter table public.invoice_reminders add constraint invoice_reminders_status_valid
 check(status in ('pending','sending','unknown','sent','failed','skipped'));
revoke insert,update,delete on public.invoice_reminders from authenticated;

create table public.reminder_send_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 reminder_id uuid not null unique,
 payload jsonb not null,
 provider_key text not null unique,
 created_at timestamptz not null default now(),
 unique(id,user_id),
 foreign key(reminder_id,user_id) references public.invoice_reminders(id,user_id)
);
create table public.reminder_send_outcomes (
 attempt_id uuid primary key,
 user_id uuid not null,
 outcome text not null check(outcome in ('accepted','unknown')),
 provider_message_id text,
 created_at timestamptz not null default now(),
 foreign key(attempt_id,user_id) references public.reminder_send_attempts(id,user_id),
 check((outcome='accepted' and provider_message_id is not null and length(btrim(provider_message_id))>0) or (outcome='unknown' and provider_message_id is null))
);
alter table public.reminder_send_attempts enable row level security;
alter table public.reminder_send_outcomes enable row level security;
revoke all on public.reminder_send_attempts,public.reminder_send_outcomes from public,anon,authenticated,service_role;
grant select on public.reminder_send_attempts,public.reminder_send_outcomes to authenticated,service_role;
create policy reminder_attempt_owner on public.reminder_send_attempts for select to authenticated using(user_id=(select auth.uid()));
create policy reminder_outcome_owner on public.reminder_send_outcomes for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_reminder_attempt before update or delete on public.reminder_send_attempts for each row execute function public.reject_source_mutation();
create trigger immutable_reminder_outcome before update or delete on public.reminder_send_outcomes for each row execute function public.reject_source_mutation();

create function public.create_due_reminder(p_owner uuid,p_invoice uuid,p_updated_at timestamptz,p_amount bigint,p_from text,p_recipient text,p_subject text,p_message text)
returns uuid language plpgsql security definer set search_path='' as $$
declare inv public.invoices; b record; draft uuid; stamp timestamptz;
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into inv from public.invoices where id=p_invoice and user_id=p_owner for update;
 if not found or inv.origin<>'native_gbp' or inv.currency<>'GBP' or inv.status<>'finalised' or inv.amount is null or inv.paid_at is not null
  or inv.updated_at is distinct from p_updated_at or not inv.reminder_enabled or inv.next_reminder_at is null or inv.next_reminder_at>now() then
  raise exception 'Scheduled invoice changed. Refresh the draft.';
 end if;
 if exists(select 1 from public.invoice_reminders where invoice_id=p_invoice and user_id=p_owner and status in ('pending','sending','unknown','failed')) then
  raise exception 'An existing reminder needs review.';
 end if;
 if (select count(*) from public.invoice_reminders where invoice_id=p_invoice and user_id=p_owner and status='sent') >=
  (case when inv.reminder_schedule->>'maxReminders' ~ '^[1-9][0-9]{0,3}$' then (inv.reminder_schedule->>'maxReminders')::integer else 3 end) then raise exception 'Reminder limit reached.'; end if;
 select * into b from public.invoice_payment_balances where id=p_invoice and user_id=p_owner;
 if b.outstanding_pence is distinct from p_amount or p_amount is null or p_amount<=0 or b.credited_pence<>0 then raise exception 'Invoice balance changed.'; end if;
 if p_from is null or length(btrim(p_from))=0 or p_recipient is distinct from (select btrim(email) from public.clients where id=inv.client_id and user_id=p_owner) then raise exception 'Reminder address changed.'; end if;
 update public.invoices set reminder_enabled=false,next_reminder_at=null where id=p_invoice returning updated_at into stamp;
 insert into public.invoice_reminders(user_id,invoice_id,client_id,recipient_email,from_email,subject,message,balance_updated_at,amount_due_pence)
 values(p_owner,p_invoice,inv.client_id,p_recipient,p_from,p_subject,p_message,stamp,p_amount) returning id into draft;
 return draft;
end $$;

create function public.claim_reminder_send(p_owner uuid,p_reminder uuid,p_updated_at timestamptz,p_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.invoice_reminders; inv public.invoices; b record; a public.reminder_send_attempts;
begin
 if p_owner is null or p_confirmed is distinct from true then raise exception 'Explicit confirmation is required.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select i.* into inv from public.invoices i join public.invoice_reminders d on d.invoice_id=i.id and d.user_id=i.user_id where d.id=p_reminder and d.user_id=p_owner for update of i;
 if not found then raise exception 'Reminder unavailable.'; end if;
 select * into r from public.invoice_reminders where id=p_reminder and user_id=p_owner for update;
 select * into a from public.reminder_send_attempts where reminder_id=p_reminder and user_id=p_owner;
 if found then return jsonb_build_object('claimed',false,'status',r.status); end if;
 if r.status<>'pending' or r.updated_at is distinct from p_updated_at or r.from_email is null then raise exception 'Review a fresh reminder before sending.'; end if;
 select * into b from public.invoice_payment_balances where id=inv.id and user_id=p_owner;
 if inv.origin<>'native_gbp' or inv.currency<>'GBP' or inv.amount is null or inv.status<>'finalised' or inv.paid_at is not null
  or inv.updated_at is distinct from r.balance_updated_at or b.outstanding_pence is distinct from r.amount_due_pence or coalesce(r.amount_due_pence,0)<=0 or b.credited_pence<>0 then raise exception 'Invoice balance changed. Review a fresh reminder.'; end if;
 if r.recipient_email is distinct from (select btrim(email) from public.clients where id=inv.client_id and user_id=p_owner) then raise exception 'Recipient changed. Review a fresh reminder.'; end if;
 insert into public.reminder_send_attempts(user_id,reminder_id,payload,provider_key)
 values(p_owner,r.id,jsonb_build_object('from',r.from_email,'to',r.recipient_email,'subject',r.subject,'text',r.message,'invoice_id',inv.id,'balance_updated_at',r.balance_updated_at,'amount_due_pence',r.amount_due_pence),'invoice-reminder-'||r.id::text) returning * into a;
 update public.invoice_reminders set status='sending' where id=r.id;
 return jsonb_build_object('claimed',true,'attempt_id',a.id,'provider_key',a.provider_key,'payload',a.payload);
end $$;

create function public.record_reminder_outcome(p_owner uuid,p_attempt uuid,p_outcome text,p_provider_id text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.reminder_send_attempts; r public.invoice_reminders; prior public.reminder_send_outcomes;
begin
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||p_owner::text,0));
 select * into a from public.reminder_send_attempts where id=p_attempt and user_id=p_owner;
 if not found then raise exception 'Attempt unavailable.'; end if;
 select * into prior from public.reminder_send_outcomes where attempt_id=a.id;
 if found then
  if prior.outcome is distinct from p_outcome or prior.provider_message_id is distinct from p_provider_id then raise exception 'Outcome already recorded.'; end if;
  return;
 end if;
 perform 1 from public.invoices where id=(a.payload->>'invoice_id')::uuid and user_id=p_owner for update;
 select * into r from public.invoice_reminders where id=a.reminder_id and user_id=p_owner for update;
 insert into public.reminder_send_outcomes(attempt_id,user_id,outcome,provider_message_id) values(a.id,p_owner,p_outcome,p_provider_id);
 update public.invoice_reminders set status=case when p_outcome='accepted' then 'sent' else 'unknown' end,
  provider_message_id=p_provider_id,sent_at=case when p_outcome='accepted' then now() else null end,
  error=case when p_outcome='unknown' then 'Delivery outcome needs checking. Do not resend.' else null end where id=r.id;
 -- Compare with the approved invoice version: an owner stop or balance change
 -- during transport must never be overwritten by scheduling the next draft.
 if p_outcome='accepted' then
  update public.invoices set reminder_enabled=true,next_reminder_at=now()+make_interval(days=>
   case when reminder_schedule->>'repeatEveryDays' ~ '^[1-9][0-9]{0,2}$' then least((reminder_schedule->>'repeatEveryDays')::integer,365) else 7 end)
   where id=r.invoice_id and user_id=p_owner and updated_at=r.balance_updated_at and paid_at is null
   and (select count(*) from public.invoice_reminders where invoice_id=r.invoice_id and user_id=p_owner and status='sent') <
    (case when reminder_schedule->>'maxReminders' ~ '^[1-9][0-9]{0,3}$' then (reminder_schedule->>'maxReminders')::integer else 3 end);
 end if;
end $$;

create function public.discard_reminder(p_reminder uuid) returns void language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();
begin
 if owner_id is null then raise exception 'Sign in.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 update public.invoice_reminders set status='skipped',error='Discarded by owner.' where id=p_reminder and user_id=owner_id and status='pending';
 if not found then raise exception 'Pending reminder unavailable.'; end if;
end $$;
revoke all on function public.create_due_reminder(uuid,uuid,timestamptz,bigint,text,text,text,text),public.claim_reminder_send(uuid,uuid,timestamptz,boolean),public.record_reminder_outcome(uuid,uuid,text,text),public.discard_reminder(uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_due_reminder(uuid,uuid,timestamptz,bigint,text,text,text,text),public.claim_reminder_send(uuid,uuid,timestamptz,boolean),public.record_reminder_outcome(uuid,uuid,text,text) to service_role;
grant execute on function public.discard_reminder(uuid) to authenticated;
