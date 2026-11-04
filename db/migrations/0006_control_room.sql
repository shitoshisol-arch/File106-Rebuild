-- The control room migration: scheduled publication, file lifecycle, richer
-- puzzles, and the missing file attributes.
--
-- Every existing column and rule is preserved. Everything here widens what an
-- archivist can express; nothing narrows an existing behaviour, so the older
-- panels keep working without edits. Anything that could surprise the archive
-- (the scheduler, delete guards) is enforced in the application, not here.

-- ---------------------------------------------------------------------
-- Files: story fields the editor needs
-- ---------------------------------------------------------------------

alter table files
  add column if not exists subtitle text not null default '',
  add column if not exists file_type text not null default 'story',
  add column if not exists sort_order integer not null default 0,
  add column if not exists requires_registration boolean not null default true,
  add column if not exists requires_wallet boolean not null default true,
  add column if not exists rewards_enabled boolean not null default true,
  add column if not exists cover_attachment_id uuid;

-- One classification of what the record presents as. The public upload panel
-- may grow specialised rendering later; for now it annotates the list and the
-- file page.
alter table files
  drop constraint if exists files_file_type_check;
alter table files
  add constraint files_file_type_check check (file_type in (
    'story', 'transmission', 'puzzle', 'image_evidence',
    'encrypted', 'reward_challenge', 'classified'
  ));

-- Scheduled joins the lifecycle: the scheduler flips it to 'open' when
-- opens_at arrives, and flips open to 'closed' once closes_at has passed.
alter table files
  drop constraint if exists files_status_check;
alter table files
  add constraint files_status_check check (status in (
    'draft', 'scheduled', 'open', 'locked', 'closed', 'completed', 'archived'
  ));

-- A file points at one of its own image attachments as the cover. The FK makes
-- the pointer structural and ON DELETE SET NULL keeps a cover removal from
-- taking the whole file down.
alter table files
  drop constraint if exists files_cover_attachment_fk;
alter table files
  add constraint files_cover_attachment_fk foreign key (cover_attachment_id)
    references file_attachments (id) on delete set null;

-- Indexes for the manager screens: list ordering and lifecycle filters.
create index if not exists files_sort_order_idx on files (sort_order asc, file_number asc);
create index if not exists files_status_idx2 on files (status) where status in ('draft', 'scheduled', 'open');

-- Seed the display order from the file number so the existing archive keeps
-- its shape and the reorder controls start from something visible.
update files set sort_order = file_number where sort_order = 0;

-- ---------------------------------------------------------------------
-- Attachments: one of an image's copies can be marked public as a cover
-- ---------------------------------------------------------------------

alter table file_attachments
  add column if not exists is_public boolean not null default false;
create index if not exists file_attachments_public_idx
  on file_attachments (file_id) where is_public;

-- ---------------------------------------------------------------------
-- Clues: difficulty and scheduled release
-- ---------------------------------------------------------------------

alter table clues
  add column if not exists difficulty text not null default 'medium',
  add column if not exists release_at timestamptz;

alter table clues
  drop constraint if exists clues_difficulty_check;
alter table clues
  add constraint clues_difficulty_check check (difficulty in ('easy', 'medium', 'hard', 'brutal'));

-- ---------------------------------------------------------------------
-- Puzzles: the rich editor rung under the sealed answer
-- ---------------------------------------------------------------------

-- puzzle_type does not displace answer_format: text and numeric remain, and
-- the richer types map onto them internally (a 'choice' puzzle's answer is the
-- label of the chosen option, a 'code' or 'password' puzzle is a text answer
-- displayed as a code field, 'multi_step' is an ordered sequence of positions).
alter table challenges
  add column if not exists puzzle_type text not null default 'text',
  add column if not exists hint text not null default '';

-- For multiple-choice puzzles only: the labels of the options. The correct one
-- is never marked here — the correct label lives only as a scrypt hash.
alter table challenges
  add column if not exists choices jsonb not null default '[]'::jsonb;

alter table challenges
  drop constraint if exists challenges_puzzle_type_check;
alter table challenges
  add constraint challenges_puzzle_type_check check (puzzle_type in (
    'text', 'numeric', 'password', 'choice', 'code', 'riddle', 'sequence', 'multi_step'
  ));

-- Multiple accepted answers: the primary answer stays in challenges.answer_hash
-- (unchanged contract, unchanged trigger guard); alternates live here and are
-- compared in addition. A puzzle can therefore accept, for example, both
-- "send" and "SEND" phrasings under one case rule.
create table if not exists challenge_answers (
  id                     uuid primary key default gen_random_uuid(),
  challenge_id           uuid not null references challenges (id) on delete cascade,
  position               integer not null default 1
                           check (position between 1 and 10),
  answer_hash            text not null,
  created_at             timestamptz not null default now(),
  unique (challenge_id, position)
);
create index if not exists challenge_answers_challenge_idx
  on challenge_answers (challenge_id);

-- The sealed-answer freeze extends to alternates: once someone has submitted
-- against a puzzle, its answers are frozen in every direction — set, replaced,
-- added or removed. The admin may still edit surface fields (prompt, hint,
-- choices, attempts), because those cannot rewrite what a submitted answer
-- meant. The primary hash is covered by challenges_guard (0001) already.
create or replace function challenge_answers_guard() returns trigger as $$
declare
  submissions_count integer;
begin
  select count(*) into submissions_count
    from submissions
   where challenge_id = coalesce(new.challenge_id, old.challenge_id);

  if submissions_count > 0 then
    raise exception 'challenge answers are sealed once submissions exist';
  end if;

  return coalesce(new, old);
end;
$$ language plpgsql;

drop trigger if exists challenge_answers_seal on challenge_answers;
create trigger challenge_answers_seal
  before insert or update or delete on challenge_answers
  for each row execute function challenge_answers_guard();

-- ---------------------------------------------------------------------
-- Control-room settings for preferences the archive reads at request time
-- ---------------------------------------------------------------------

insert into settings (key, value, description)
  values
    ('archive.default_min_holding', '"1.00000000"', 'Prefilled minimum holding when an archivist creates a file'),
    ('archive.default_reward',      '"1.00000000"', 'Prefilled reward amount when an archivist creates a file'),
    ('archive.maintenance_banner',  'false',        'Shows a red notice on public archive pages when true'),
    ('archive.tagline',             '"PROJECT105: TERMINATED. FILE106: STILL ACTIVE."', 'Line shown in the archive sidebar')
  on conflict (key) do nothing;
