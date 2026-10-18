-- Exact currency arithmetic only. Existing GBP source/invoice constraints remain.
create table public.fx_currency_rulesets (
 id text primary key, definition jsonb not null, created_at timestamptz not null default now(),
 check(jsonb_typeof(definition)='object')
);
alter table public.fx_currency_rulesets enable row level security;
revoke all on public.fx_currency_rulesets from public,anon,authenticated,service_role;
grant select on public.fx_currency_rulesets to authenticated,service_role;
create policy fx_currency_rulesets_read on public.fx_currency_rulesets for select to authenticated using(true);
create trigger immutable_fx_currency_ruleset before update or delete on public.fx_currency_rulesets for each row execute function public.reject_source_mutation();
insert into public.fx_currency_rulesets(id,definition) values('vibecount-currencies/1',
 '{"currencies":{"GBP":{"exponent":2,"name":"Pound Sterling"},"USD":{"exponent":2,"name":"US Dollar"},"EUR":{"exponent":2,"name":"Euro"},"JPY":{"exponent":0,"name":"Yen"},"KWD":{"exponent":3,"name":"Kuwaiti Dinar"}},"source":{"url":"https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml","published":"2026-09-17","checked":"2026-10-17","sha256":"33139b438657d1cee116ba737807ea71d19d6de4b90f799a09c56f0cc6a1b0ff"},"rounding":"nearest_minor_ties_away_from_zero/1","review_status":"currency_scale_checked_not_tax_or_fx_treatment_approval"}'::jsonb);

-- Private invoker helpers for future reviewed writers; no public financial RPC.
create function public.fx_currency_scale(p_currency text,p_ruleset text) returns numeric
language plpgsql stable security invoker set search_path='' as $$
declare rules jsonb;exponent integer;
begin
 select definition->'currencies' into rules from public.fx_currency_rulesets where id=p_ruleset;
 if p_currency is null or rules is null or not(rules ? p_currency) then raise exception 'Choose an explicitly supported currency ruleset.';end if;
 exponent:=(rules->p_currency->>'exponent')::integer;
 return power(10::numeric,exponent);
end;$$;
revoke all on function public.fx_currency_scale(text,text) from public,anon,authenticated,service_role;

create function public.fx_decimal_to_minor(p_amount text,p_currency text,p_ruleset text) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare scale numeric;exponent integer;parts text[];magnitude numeric;result numeric;
begin
 scale:=public.fx_currency_scale(p_currency,p_ruleset);exponent:=length(scale::bigint::text)-1;
 if p_amount is null or length(p_amount)>32 then raise exception 'Enter a bounded exact currency amount.';end if;
 parts:=regexp_match(p_amount,'^(-?)([0-9]+)(?:\.([0-9]+))?$');
 if parts is null or length(coalesce(parts[3],''))>exponent then raise exception 'Use the currency exact decimal places.';end if;
 magnitude:=parts[2]::numeric*scale+coalesce(nullif(rpad(coalesce(parts[3],''),exponent,'0'),'')::numeric,0);
 result:=case when parts[1]='-' then -magnitude else magnitude end;
 if result not between -999999999999 and 999999999999 then raise exception 'Currency amount exceeds the supported bound.';end if;
 return result::bigint;
end;$$;
revoke all on function public.fx_decimal_to_minor(text,text,text) from public,anon,authenticated,service_role;

create function public.fx_convert_minor(p_source_minor bigint,p_rate jsonb,p_ruleset text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare n numeric;d numeric;a numeric;b numeric;r numeric;common numeric;source_scale numeric;target_scale numeric;
 minor_n numeric;minor_d numeric;exact_n numeric;magnitude numeric;whole numeric;remainder numeric;rounded numeric;rate jsonb;key_count integer;
begin
 if p_source_minor is null or p_source_minor not between -999999999999 and 999999999999 then raise exception 'Use bounded exact currency minor units.';end if;
 if jsonb_typeof(p_rate) is distinct from 'object' then raise exception 'Review a plain exact rate.';end if;
 select count(*) into key_count from jsonb_object_keys(p_rate);
 if key_count<>5 or not(p_rate ?& array['direction','source_currency','target_currency','numerator','denominator']) then raise exception 'Review exact rate fields.';end if;
 if p_rate->>'direction' is distinct from 'target_major_per_source_major'
  or jsonb_typeof(p_rate->'source_currency') is distinct from 'string' or jsonb_typeof(p_rate->'target_currency') is distinct from 'string'
  or jsonb_typeof(p_rate->'numerator') is distinct from 'string' or jsonb_typeof(p_rate->'denominator') is distinct from 'string'
  or p_rate->>'numerator' !~ '^[1-9][0-9]{0,17}$' or p_rate->>'denominator' !~ '^[1-9][0-9]{0,17}$' then raise exception 'Review exact positive rational rate and direction.';end if;
 source_scale:=public.fx_currency_scale(p_rate->>'source_currency',p_ruleset);target_scale:=public.fx_currency_scale(p_rate->>'target_currency',p_ruleset);
 n:=(p_rate->>'numerator')::numeric;d:=(p_rate->>'denominator')::numeric;
 if p_rate->>'source_currency'=p_rate->>'target_currency' and n<>d then raise exception 'Matching currencies require an identity rate.';end if;
 a:=n;b:=d;while b<>0 loop r:=mod(a,b);a:=b;b:=r;end loop;common:=a;
 n:=div(n,common);d:=div(d,common);
 rate:=jsonb_build_object('direction','target_major_per_source_major','source_currency',p_rate->>'source_currency','target_currency',p_rate->>'target_currency','numerator',n::text,'denominator',d::text);
 minor_n:=n*target_scale;minor_d:=d*source_scale;
 a:=minor_n;b:=minor_d;while b<>0 loop r:=mod(a,b);a:=b;b:=r;end loop;common:=a;
 minor_n:=div(minor_n,common);minor_d:=div(minor_d,common);exact_n:=p_source_minor::numeric*minor_n;
 magnitude:=abs(exact_n);whole:=div(magnitude,minor_d);remainder:=mod(magnitude,minor_d);
 rounded:=(whole+case when remainder*2>=minor_d then 1 else 0 end)*case when exact_n<0 then -1 else 1 end;
 if rounded not between -999999999999 and 999999999999 then raise exception 'Converted amount exceeds the supported bound.';end if;
 return jsonb_build_object('ruleset_id',p_ruleset,'rounding','nearest_minor_ties_away_from_zero/1','rate',rate,'source_minor',p_source_minor,'target_minor',rounded::bigint,
  'minor_rate_numerator',minor_n::text,'minor_rate_denominator',minor_d::text,'exact_target_numerator',exact_n::text,'rounding_delta_numerator',(rounded*minor_d-exact_n)::text);
end;$$;
revoke all on function public.fx_convert_minor(bigint,jsonb,text) from public,anon,authenticated,service_role;

create function public.fx_convert_tranche(p_rate jsonb,p_prior_source bigint,p_prior_target bigint,p_portion bigint,p_ruleset text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare before_value jsonb;after_value jsonb;portion_target bigint;
begin
 if p_prior_source is null or p_prior_target is null or p_portion is null or p_prior_source not between -999999999999 and 999999999999
  or p_prior_target not between -999999999999 and 999999999999 or p_portion not between -999999999999 and 999999999999
  or p_portion=0 or(p_prior_source<>0 and sign(p_prior_source)<>sign(p_portion)) then raise exception 'Use a bounded forward portion of one unchanged conversion lot.';end if;
 before_value:=public.fx_convert_minor(p_prior_source,p_rate,p_ruleset);
 if(before_value->>'target_minor')::bigint<>p_prior_target then raise exception 'Retained lot conversion is inconsistent.';end if;
 after_value:=public.fx_convert_minor(p_prior_source+p_portion,p_rate,p_ruleset);
 portion_target:=(after_value->>'target_minor')::bigint-(before_value->>'target_minor')::bigint;
 return jsonb_build_object('before',before_value,'after',after_value,'portion_source_minor',p_portion,'portion_target_minor',portion_target,'reversal_policy','retain_approved_portions_reverse_dependencies');
end;$$;
revoke all on function public.fx_convert_tranche(jsonb,bigint,bigint,bigint,text) from public,anon,authenticated,service_role;
