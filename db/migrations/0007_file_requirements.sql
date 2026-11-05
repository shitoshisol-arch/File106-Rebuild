-- Per-file reward conditions.
--
-- A file can carry a short checklist of partner tasks (follow this account,
-- open this link) that a participant must complete before the archivist may
-- create a reward for that file.
--
-- The green check is deliberately evidence-based:
--   * A verification row is born 'pending' with the participant's proof.
--   * Only an archivist review flips it to 'verified' and stores checked_at and
--     reviewed_by. The check constraint below refuses a 'verified' row without
--     both, so no code path can manufacture a green check from a click.
--   * A rejection is stored as 'rejected' and renders red to the participant.
--
-- The reward insert trigger is the backstop: even a direct SQL insert cannot
-- create a reward while a required condition is unverified.

create table if not exists file_requirements (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid not null references files (id) on delete cascade,
  position      integer not null default 1 check (position between 1 and 20),
  kind          text not null default 'social_follow'
                check (kind in ('social_follow', 'visit_link', 'custom')),
  platform      text not null default 'x'
                check (platform in ('x', 'telegram', 'discord', 'instagram',
                                    'tiktok', 'youtube', 'website', 'other')),
  title         text not null check (length(btrim(title)) between 1 and 120),
  description   text not null default '',
  target_url    text not null check (target_url ~ '^https://'),
  target_handle text not null default '',
  is_required   boolean not null default true,
  created_by    uuid references admin_users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (file_id, position)
);

create index if not exists file_requirements_file_idx
  on file_requirements (file_id, position);

create table if not exists file_requirement_verifications (
  id            uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references file_requirements (id) on delete cascade,
  file_id       uuid not null references files (id) on delete cascade,
  user_id       uuid not null references users (id) on delete cascade,
  status        text not null default 'pending'
                check (status in ('pending', 'verified', 'rejected')),
  proof         text not null default '',
  method        text not null default 'manual_review'
                check (method in ('manual_review', 'x_oauth', 'telegram_bot')),
  reviewed_by   uuid references admin_users (id),
  checked_at    timestamptz,
  reviewer_note text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (requirement_id, user_id),
  -- A green check must name the human who checked it and when.
  constraint file_requirement_verifications_green_needs_reviewer
    check (
      status <> 'verified'
      or (checked_at is not null and reviewed_by is not null)
    ),
  -- A pending review must carry the proof being reviewed.
  constraint file_requirement_verifications_pending_needs_proof
    check (status <> 'pending' or length(btrim(proof)) > 0)
);

create index if not exists frv_user_idx
  on file_requirement_verifications (user_id, status);
create index if not exists frv_file_idx
  on file_requirement_verifications (file_id, status);
create index if not exists frv_requirement_idx
  on file_requirement_verifications (requirement_id, status);

-- Defense in depth: reward creation is refused until every required condition
-- on the file has a verified row for the winning participant.
create or replace function rewards_require_verified_conditions() returns trigger as $$
declare
  missing integer;
begin
  select count(*) into missing
    from file_requirements r
    left join file_requirement_verifications v
      on v.requirement_id = r.id and v.user_id = new.user_id
   where r.file_id = new.file_id
     and r.is_required
     and (
       v.id is null
       or v.status <> 'verified'
       or v.checked_at is null
       or v.reviewed_by is null
     );

  if missing > 0 then
    raise exception 'reward_conditions_incomplete'
      using errcode = 'check_violation',
            hint = 'Every required file condition needs an archivist-verified row first.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists rewards_conditions_guard on rewards;
create trigger rewards_conditions_guard
  before insert on rewards
  for each row execute function rewards_require_verified_conditions();

-- The participant timeline gains one entry type: a condition proof and its
-- review. Existing types are untouched.
alter table investigation_logs
  drop constraint if exists investigation_logs_entry_type_check;
alter table investigation_logs
  add constraint investigation_logs_entry_type_check
  check (entry_type in ('discovery', 'clue', 'puzzle', 'unlock', 'reward', 'requirement'));
