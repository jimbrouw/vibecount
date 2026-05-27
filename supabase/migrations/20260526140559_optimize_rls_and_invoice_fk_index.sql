create index invoices_client_user_idx
  on public.invoices (client_id, user_id);

drop policy "Users can read their own clients" on public.clients;
drop policy "Users can create their own clients" on public.clients;
drop policy "Users can update their own clients" on public.clients;
drop policy "Users can delete their own clients" on public.clients;

drop policy "Users can read their own invoices" on public.invoices;
drop policy "Users can create their own invoices" on public.invoices;
drop policy "Users can update their own invoices" on public.invoices;
drop policy "Users can delete their own invoices" on public.invoices;

create policy "Users can read their own clients"
on public.clients
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own clients"
on public.clients
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can update their own clients"
on public.clients
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "Users can delete their own clients"
on public.clients
for delete
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can read their own invoices"
on public.invoices
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own invoices"
on public.invoices
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.clients
    where clients.id = invoices.client_id
      and clients.user_id = (select auth.uid())
  )
);

create policy "Users can update their own invoices"
on public.invoices
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1
    from public.clients
    where clients.id = invoices.client_id
      and clients.user_id = (select auth.uid())
  )
);

create policy "Users can delete their own invoices"
on public.invoices
for delete
to authenticated
using ((select auth.uid()) = user_id);
