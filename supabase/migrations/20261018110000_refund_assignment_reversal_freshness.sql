-- Preserve reviewed assignment reversal after waiting for the invoice lock.
-- Historical request fingerprints/results and recovery-before-live-read are unchanged.
create or replace function public.reverse_invoice_refund_assignment(p_assignment uuid,p_stamp text,p_reason text,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); a public.invoice_refund_assignments; prior public.invoice_refund_requests; payload text; reversal uuid; result jsonb;
begin
 if owner_id is null then raise exception 'Sign in to reverse refund assignments.'; end if;
 if p_assignment is null or p_request is null or p_reason is null or length(btrim(p_reason)) not between 1 and 1000 then raise exception 'Review the reversal and reason.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('reconciliation:'||owner_id::text,0));
 payload:=encode(sha256(convert_to(jsonb_build_object('action','reverse','assignment',p_assignment,'stamp',p_stamp,'reason',btrim(p_reason))::text,'UTF8')),'hex');
 select * into prior from public.invoice_refund_requests where user_id=owner_id and request_id=p_request;
 if found then if prior.payload_hash<>payload then raise exception 'Refund assignment request changed.'; end if; return prior.result; end if;
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Reconciliation changed. Review the refund reversal again.'; end if;
 select * into a from public.active_invoice_refund_assignments where id=p_assignment and user_id=owner_id;
 if not found then raise exception 'Active owned refund assignment not found.'; end if;
 perform 1 from public.invoices where id=a.invoice_id and user_id=owner_id for update;
 -- An allowed invoice update may commit while this row lock is pending.
 if public.reconciliation_export_stamp() is distinct from p_stamp then raise exception 'Reconciliation changed. Review the refund reversal again.'; end if;
 insert into public.invoice_refund_assignment_reversals(user_id,assignment_id,author,rationale,request_id) values(owner_id,a.id,owner_id,btrim(p_reason),p_request) returning id into reversal;
 perform public.sync_invoice_settlement_state(a.invoice_id,owner_id);
 result:=jsonb_build_object('reversal_id',reversal,'amount_pence',a.amount_pence,'recognized_income_change_pence',0);
 insert into public.invoice_refund_requests(user_id,request_id,payload_hash,result) values(owner_id,p_request,payload,result);
 return result;
end; $$;
revoke all on function public.reverse_invoice_refund_assignment(uuid,text,text,uuid) from public,anon,service_role;
grant execute on function public.reverse_invoice_refund_assignment(uuid,text,text,uuid) to authenticated;
