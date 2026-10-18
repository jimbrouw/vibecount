-- Verified provider evidence augments, rather than overwrites, the initial outcome.
alter table public.invoice_reminders add column provider_delivery_state text
 check(provider_delivery_state in ('accepted','delivered','delayed','needs_attention'));
create table public.reminder_provider_receipts (
 attempt_id uuid primary key,user_id uuid not null,provider_message_id text not null unique,
 message_sha256 text not null check(message_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 unique(attempt_id,user_id,provider_message_id),
 foreign key(attempt_id,user_id) references public.reminder_send_attempts(id,user_id)
);
create table public.reminder_provider_events (
 event_id text primary key check(length(event_id) between 1 and 200),
 attempt_id uuid not null,user_id uuid not null,provider_message_id text not null,
 event_type text not null check(event_type in ('email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed')),
 occurred_at timestamptz not null,body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 foreign key(attempt_id,user_id,provider_message_id) references public.reminder_provider_receipts(attempt_id,user_id,provider_message_id)
);
create index reminder_provider_events_attempt on public.reminder_provider_events(attempt_id,occurred_at);
alter table public.reminder_provider_receipts enable row level security;
alter table public.reminder_provider_events enable row level security;
revoke all on public.reminder_provider_receipts,public.reminder_provider_events from public,anon,authenticated,service_role;
grant select on public.reminder_provider_receipts,public.reminder_provider_events to authenticated,service_role;
create policy reminder_provider_receipt_owner on public.reminder_provider_receipts for select to authenticated using(user_id=(select auth.uid()));
create policy reminder_provider_event_owner on public.reminder_provider_events for select to authenticated using(user_id=(select auth.uid()));
create trigger immutable_reminder_receipt before update or delete on public.reminder_provider_receipts for each row execute function public.reject_source_mutation();
create trigger immutable_reminder_event before update or delete on public.reminder_provider_events for each row execute function public.reject_source_mutation();

create function public.record_reminder_provider_event(p_attempt uuid,p_event_id text,p_event_type text,p_occurred_at timestamptz,p_body_sha256 text,p_email jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare a public.reminder_send_attempts; receipt public.reminder_provider_receipts; prior public.reminder_provider_events;
 r public.invoice_reminders; message_id text; message_hash text; delivery text;
begin
 select * into a from public.reminder_send_attempts where id=p_attempt;
 if not found then raise exception 'Attempt unavailable.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||a.user_id::text,0));
 perform 1 from public.invoices where id=(a.payload->>'invoice_id')::uuid and user_id=a.user_id for update;
 select * into r from public.invoice_reminders where id=a.reminder_id and user_id=a.user_id for update;
 message_id:=p_email->>'id';
 if message_id is null or message_id !~ '^[0-9a-fA-F-]{36}$'
  or p_email->>'from' is distinct from a.payload->>'from' or p_email->'to' is distinct from jsonb_build_array(a.payload->>'to')
  or p_email->>'subject' is distinct from a.payload->>'subject' or p_email->>'text' is distinct from a.payload->>'text'
  or p_email->>'attempt_id' is distinct from a.id::text then raise exception 'Provider message does not match the approved attempt.'; end if;
 if r.provider_message_id is not null and r.provider_message_id<>message_id then raise exception 'Provider identity changed.'; end if;
 message_hash:=encode(sha256(convert_to(jsonb_build_object('from',p_email->>'from','to',p_email->'to','subject',p_email->>'subject','text',p_email->>'text','attempt_id',a.id)::text,'UTF8')),'hex');
 select * into receipt from public.reminder_provider_receipts where attempt_id=a.id;
 if found then
  if receipt.provider_message_id<>message_id or receipt.message_sha256<>message_hash then raise exception 'Provider receipt changed.'; end if;
 else
  insert into public.reminder_provider_receipts(attempt_id,user_id,provider_message_id,message_sha256) values(a.id,a.user_id,message_id,message_hash);
 end if;
 select * into prior from public.reminder_provider_events where event_id=p_event_id;
 if found then
  if prior.attempt_id<>a.id or prior.body_sha256 is distinct from p_body_sha256 or prior.event_type is distinct from p_event_type or prior.occurred_at is distinct from p_occurred_at then raise exception 'Provider event changed.'; end if;
  return;
 end if;
 insert into public.reminder_provider_events(event_id,attempt_id,user_id,provider_message_id,event_type,occurred_at,body_sha256)
 values(p_event_id,a.id,a.user_id,message_id,p_event_type,p_occurred_at,p_body_sha256);
 select case when bool_or(event_type in ('email.bounced','email.complained','email.failed','email.suppressed')) then 'needs_attention'
  when bool_or(event_type='email.delivered') then 'delivered'
  when bool_or(event_type='email.delivery_delayed') then 'delayed' else 'accepted' end into delivery
 from public.reminder_provider_events where attempt_id=a.id;
 update public.invoice_reminders set status='sent',provider_message_id=message_id,provider_delivery_state=delivery,
  sent_at=coalesce(sent_at,now()),error=case when delivery='needs_attention' then 'Provider reported a delivery problem. Review delivery history.' else null end where id=r.id;
 if delivery='needs_attention' then
  update public.invoices set reminder_enabled=false,next_reminder_at=null where id=r.invoice_id and user_id=a.user_id;
 end if;
 -- A recovered attempt never causes a send or silently starts a new schedule.
end $$;
revoke all on function public.record_reminder_provider_event(uuid,text,text,timestamptz,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.record_reminder_provider_event(uuid,text,text,timestamptz,text,jsonb) to service_role;

-- Preserve evidence that can arrive while the original request is still in flight.
create or replace function public.record_reminder_outcome(p_owner uuid,p_attempt uuid,p_outcome text,p_provider_id text)
returns void language plpgsql security definer set search_path='' as $$
declare a public.reminder_send_attempts; r public.invoice_reminders; prior public.reminder_send_outcomes; receipt public.reminder_provider_receipts;
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
 select * into receipt from public.reminder_provider_receipts where attempt_id=a.id and user_id=p_owner;
 if found and p_outcome='accepted' and receipt.provider_message_id is distinct from p_provider_id then raise exception 'Provider identity changed.'; end if;
 insert into public.reminder_send_outcomes(attempt_id,user_id,outcome,provider_message_id) values(a.id,p_owner,p_outcome,p_provider_id);
 if receipt.attempt_id is null then
  update public.invoice_reminders set status=case when p_outcome='accepted' then 'sent' else 'unknown' end,
   provider_message_id=p_provider_id,sent_at=case when p_outcome='accepted' then now() else null end,
   error=case when p_outcome='unknown' then 'Delivery outcome needs checking. Do not resend.' else null end where id=r.id;
 end if;
 if p_outcome='accepted' and coalesce(r.provider_delivery_state,'accepted')<>'needs_attention' then
  update public.invoices set reminder_enabled=true,next_reminder_at=now()+make_interval(days=>
   case when reminder_schedule->>'repeatEveryDays' ~ '^[1-9][0-9]{0,2}$' then least((reminder_schedule->>'repeatEveryDays')::integer,365) else 7 end)
   where id=r.invoice_id and user_id=p_owner and updated_at=r.balance_updated_at and paid_at is null
   and (select count(*) from public.invoice_reminders where invoice_id=r.invoice_id and user_id=p_owner and status='sent') <
    (case when reminder_schedule->>'maxReminders' ~ '^[1-9][0-9]{0,3}$' then (reminder_schedule->>'maxReminders')::integer else 3 end);
 end if;
end $$;
