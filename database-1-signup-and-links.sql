-- =====================================================================
-- Distant Intention Study · Database script 1 of 3
-- Sign-up, questionnaire, invites and partner links.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → New query →
-- paste this whole file → Run. Safe to run once on a new project.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Relationship words. "They are my ___". Each has an opposite, used to
-- check that two linked people describe each other the same way.
-- ---------------------------------------------------------------------
create or replace function public.relationship_opposite(r text)
returns text language sql immutable as $$
  select case r
    when 'parent' then 'child'           when 'child' then 'parent'
    when 'grandparent' then 'grandchild' when 'grandchild' then 'grandparent'
    when 'aunt_uncle' then 'niece_nephew' when 'niece_nephew' then 'aunt_uncle'
    else r end
$$;

create or replace function public.is_relationship(r text)
returns boolean language sql immutable as $$
  select r in ('identical_twin','non_identical_twin','sibling','cousin','parent','child',
               'grandparent','grandchild','aunt_uncle','niece_nephew','partner',
               'close_friend','friend','colleague','other')
$$;

-- ---------------------------------------------------------------------
-- Profiles: the sign-up questionnaire. One row per player.
-- ---------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  created_at       timestamptz not null default now(),
  adult_confirmed  boolean not null default false,
  country          text check (char_length(country) <= 60),
  town             text check (char_length(town) <= 80),
  belief           smallint check (belief between 1 and 5),
  belief_at        timestamptz,
  twin_status      text check (twin_status in ('identical','non_identical','unsure','no')),
  experience       text check (experience in ('yes','no','unsure')),
  experience_note  text check (char_length(experience_note) <= 1000),
  feels_connected  text check (feels_connected in ('yes','no','later')),
  animals          jsonb not null default '{}'::jsonb,
  consent_version  text,
  consented_at     timestamptz,
  onboarded_at     timestamptz
);
alter table public.profiles enable row level security;
create policy "own profile: read"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile: create" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile: update" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
grant select, insert, update on public.profiles to authenticated;

-- Date of birth is kept in its own table and never leaves it directly.
create table public.birthdates (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  dob      date not null check (dob <= (current_date - interval '18 years') and dob >= date '1900-01-01')
);
alter table public.birthdates enable row level security;
create policy "own birthdate: read"   on public.birthdates for select to authenticated using (user_id = auth.uid());
create policy "own birthdate: create" on public.birthdates for insert to authenticated with check (user_id = auth.uid());
create policy "own birthdate: update" on public.birthdates for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update on public.birthdates to authenticated;

-- ---------------------------------------------------------------------
-- Invites. An invite link (valid 30 days) or a link code (valid 24 hours).
-- The nickname is a private reminder for the person who made it.
-- ---------------------------------------------------------------------
create table public.invites (
  code          text primary key,
  inviter       uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('invite','link_code')),
  relationship  text not null check (public.is_relationship(relationship)),
  nickname      text check (char_length(nickname) <= 30),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  redeemed_by   uuid references auth.users(id) on delete set null,
  redeemed_at   timestamptz
);
create index on public.invites (inviter);
alter table public.invites enable row level security;
create policy "own invites: read" on public.invites for select to authenticated using (inviter = auth.uid());
grant select on public.invites to authenticated;

-- ---------------------------------------------------------------------
-- Links between two people who know each other.
-- Pending until the inviter confirms; confirmed only if both describe
-- the relationship the same way (and twins share a birthday).
-- ---------------------------------------------------------------------
create table public.links (
  id                    uuid primary key default gen_random_uuid(),
  invite_code           text references public.invites(code) on delete set null,
  inviter               uuid not null references auth.users(id) on delete cascade,
  invitee               uuid not null references auth.users(id) on delete cascade,
  inviter_relationship  text not null check (public.is_relationship(inviter_relationship)),
  invitee_relationship  text not null check (public.is_relationship(invitee_relationship)),
  inviter_closeness     smallint check (inviter_closeness between 1 and 10),
  invitee_closeness     smallint not null check (invitee_closeness between 1 and 10),
  inviter_twin_answers  jsonb,
  invitee_twin_answers  jsonb,
  status                text not null default 'pending' check (status in ('pending','confirmed','mismatch','removed')),
  status_reason         text,
  created_at            timestamptz not null default now(),
  confirmed_at          timestamptz,
  check (inviter <> invitee)
);
create unique index links_one_per_pair on public.links (least(inviter, invitee), greatest(inviter, invitee)) where status <> 'removed';
alter table public.links enable row level security;
create policy "own links: read" on public.links for select to authenticated using (auth.uid() in (inviter, invitee));
grant select on public.links to authenticated;

-- ---------------------------------------------------------------------
-- Functions the app calls. They run with extra rights but check
-- everything themselves, so the tables above stay locked down.
-- ---------------------------------------------------------------------
create or replace function public.new_code() returns text language plpgsql volatile as $$
declare alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; b bytea; out text := ''; i int;
begin
  b := extensions.gen_random_bytes(6);
  for i in 0..5 loop out := out || substr(alphabet, (get_byte(b, i) % 31) + 1, 1); end loop;
  return out;
end $$;

-- Make an invite link or a 24-hour link code.
create or replace function public.create_invite(p_relationship text, p_nickname text default null, p_kind text default 'invite')
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); c text; tries int := 0;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if not public.is_relationship(p_relationship) then raise exception 'Unknown relationship.'; end if;
  if p_kind not in ('invite','link_code') then raise exception 'Unknown invite type.'; end if;
  if (select count(*) from invites where inviter = me and redeemed_at is null and expires_at > now()) >= 50 then
    raise exception 'You have 50 open invites. Wait for some to be used or expire.';
  end if;
  loop
    c := public.new_code(); tries := tries + 1;
    exit when not exists (select 1 from invites where code = c) or tries > 10;
  end loop;
  insert into invites (code, inviter, kind, relationship, nickname, expires_at)
  values (c, me, p_kind, p_relationship, nullif(trim(p_nickname), ''),
          now() + case when p_kind = 'invite' then interval '30 days' else interval '24 hours' end);
  return c;
end $$;

-- What a joining person may see about a code: only whether it works and
-- how they were described. Never who sent it.
create or replace function public.check_invite(p_code text)
returns table (valid boolean, reason text, suggested_relationship text)
language plpgsql security definer set search_path = public as $$
declare inv invites%rowtype;
begin
  select * into inv from invites where code = upper(trim(p_code));
  if not found then return query select false, 'That code wasn''t recognised.', null::text; return; end if;
  if inv.redeemed_at is not null then return query select false, 'That code has already been used.', null::text; return; end if;
  if inv.expires_at < now() then return query select false, 'That code has expired. Ask for a new one.', null::text; return; end if;
  if inv.inviter = auth.uid() then return query select false, 'That''s your own code.', null::text; return; end if;
  return query select true, null::text, public.relationship_opposite(inv.relationship);
end $$;

-- The joining person accepts and describes the relationship from their side.
create or replace function public.redeem_invite(p_code text, p_relationship text, p_closeness smallint, p_twin_answers jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); inv invites%rowtype; new_id uuid;
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  if not public.is_relationship(p_relationship) then raise exception 'Unknown relationship.'; end if;
  if p_closeness not between 1 and 10 then raise exception 'Closeness must be 1 to 10.'; end if;
  select * into inv from invites where code = upper(trim(p_code)) for update;
  if not found or inv.redeemed_at is not null or inv.expires_at < now() then raise exception 'That code is no longer valid.'; end if;
  if inv.inviter = me then raise exception 'That''s your own code.'; end if;
  if exists (select 1 from links where least(inviter,invitee) = least(inv.inviter, me)
             and greatest(inviter,invitee) = greatest(inv.inviter, me) and status <> 'removed') then
    raise exception 'You are already linked with this person.';
  end if;
  insert into links (invite_code, inviter, invitee, inviter_relationship, invitee_relationship, invitee_closeness, invitee_twin_answers)
  values (inv.code, inv.inviter, me, inv.relationship, p_relationship, p_closeness, p_twin_answers)
  returning id into new_id;
  update invites set redeemed_by = me, redeemed_at = now() where code = inv.code;
  return new_id;
end $$;

-- The inviter confirms. Checks both sides agree; twins must share a birthday.
create or replace function public.confirm_link(p_link uuid, p_closeness smallint, p_twin_answers jsonb default null)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); l links%rowtype; d1 date; d2 date; ok boolean := true; why text := null;
begin
  select * into l from links where id = p_link for update;
  if not found or l.inviter <> me then raise exception 'Link not found.'; end if;
  if l.status <> 'pending' then raise exception 'This link has already been answered.'; end if;
  if p_closeness not between 1 and 10 then raise exception 'Closeness must be 1 to 10.'; end if;
  if public.relationship_opposite(l.inviter_relationship) <> l.invitee_relationship then
    ok := false; why := 'You described the relationship differently.';
  end if;
  if ok and l.inviter_relationship in ('identical_twin','non_identical_twin') then
    select dob into d1 from birthdates where user_id = l.inviter;
    select dob into d2 from birthdates where user_id = l.invitee;
    if d1 is null or d2 is null or d1 <> d2 then ok := false; why := 'Twins need the same date of birth.'; end if;
  end if;
  update links set inviter_closeness = p_closeness, inviter_twin_answers = p_twin_answers,
         status = case when ok then 'confirmed' else 'mismatch' end, status_reason = why,
         confirmed_at = case when ok then now() end
  where id = p_link;
  return case when ok then 'confirmed' else why end;
end $$;

-- Either person can remove a link at any time.
create or replace function public.remove_link(p_link uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update links set status = 'removed' where id = p_link and auth.uid() in (inviter, invitee);
  if not found then raise exception 'Link not found.'; end if;
end $$;

-- Everything the home screen needs about your invites and links, from your side.
create or replace function public.my_connections()
returns table (kind text, id text, relationship text, nickname text, status text, status_reason text,
               needs_my_answer boolean, created_at timestamptz, link_code text, expires_at timestamptz)
language sql security definer set search_path = public stable as $$
  -- links (your nickname, if you made the invite)
  select 'link', l.id::text,
         case when l.inviter = auth.uid() then l.inviter_relationship else l.invitee_relationship end,
         case when l.inviter = auth.uid() then i.nickname end,
         l.status, l.status_reason,
         (l.inviter = auth.uid() and l.status = 'pending'),
         l.created_at, null, null
  from links l left join invites i on i.code = l.invite_code
  where auth.uid() in (l.inviter, l.invitee) and l.status <> 'removed'
  union all
  -- invites you've sent that haven't been used yet
  select 'invite', i.code, i.relationship, i.nickname, 'waiting', null, false, i.created_at, i.code, i.expires_at
  from invites i
  where i.inviter = auth.uid() and i.redeemed_at is null and i.expires_at > now()
  order by 8 desc
$$;

revoke all on function public.create_invite(text,text,text), public.check_invite(text),
  public.redeem_invite(text,text,smallint,jsonb), public.confirm_link(uuid,smallint,jsonb),
  public.remove_link(uuid), public.my_connections(), public.new_code() from public, anon;
grant execute on function public.create_invite(text,text,text), public.check_invite(text),
  public.redeem_invite(text,text,smallint,jsonb), public.confirm_link(uuid,smallint,jsonb),
  public.remove_link(uuid), public.my_connections() to authenticated;

-- Delete my account and everything linked to it (the consent promise).
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Please sign in first.'; end if;
  delete from auth.users where id = me;   -- cascades to profiles, birthdates, invites, links
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
