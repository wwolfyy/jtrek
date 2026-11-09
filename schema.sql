-- schema.sql is the normative schema for the jtrek registry.
--
-- rules/schema.md describes a record in prose, and this file is what actually enforces the
-- rules. A project that adopts jtrek receives that prose as jtrek/docs/schema.md.
--
-- A jtrek command that opens the store loads this schema into an SQLite database held in
-- memory, using node:sqlite, and then loads every row of registry.ndjson into it. That database
-- is never written to disk. `jtrek build` and `jtrek db` do write a separate file,
-- registry.db, but it is a copy for browsing only. It is gitignored, and no command reads it
-- back. The decision to keep the working database in memory was recorded in §4 of
-- work-tracking-restructure-20260808.md, a planning document of the project this schema was
-- first written for. That document is not in this repository.
--
-- The database does two jobs:
--   1. It is an index. `jtrek checkout` queries it to find related records.
--   2. It is a validator. `jtrek checkin` inserts the rows from work.json into it as a trial and
--      rolls the transaction back. It appends to registry.ndjson only if every constraint passed.
--
-- STRICT tables require SQLite 3.37 or later. The node:sqlite module in Node 25 ships 3.50 or
-- later.
--
-- ---------------------------------------------------------------------------
-- CHANGING THIS SCHEMA
-- ---------------------------------------------------------------------------
-- Changes to this schema are expected, but they do not all cost the same. Every run validates
-- the entire store against this file. A rule that is tightened therefore applies to rows that
-- were written under the old rule, and any of those rows that break it stop the store from
-- loading. The table below was measured:
--
--   SAFE (old rows still load)        BREAKS HISTORY (old rows rejected)
--   - add a nullable column           - add NOT NULL with no DEFAULT
--   - add a column with a DEFAULT     - remove an enum value
--   - add an enum value               - tighten an existing CHECK
--   - add a CHECK on a NEW column     - add a CHECK to an existing column
--
-- The right-hand column is a rule of thumb, and it is not the rule itself. The rule is that a
-- change breaks history if and only if some row already in the store violates it. That gives one
-- systematic exception to the table, and it is worth knowing, because the table would argue
-- against a change that is in fact correct. The exception is that a CHECK conditioned on a new
-- enum value cannot invalidate history.
--
-- No row already in the store can hold a value that did not exist when the row was written. A
-- rule of the form `status <> 'deferred' OR note IS NOT NULL` is therefore true for every such
-- row. This was confirmed against all 326 rows in the store before that rule was added. A rule of
-- this kind belongs here, where every command enforces it, rather than in checkin.js. A line
-- added to registry.ndjson by hand never passes through checkin.js, so a rule placed there would
-- not bind it.
--
-- An additive change can simply be made. Edit this file and rebuild.
--
-- A new column is additive only if the chain value of existing rows does not change. Each row's
-- chain value is a hash of its fields, so a new column that entered the hash as an explicit null
-- would change the hash of every row already written, and 'jtrek check' would report all of them
-- as altered. A new nullable column must therefore be added to SPARSE_FIELDS in src/store.js as
-- well as to FIELDS. A column in that set is left out of a row's line and of its hash while it is
-- null, so existing rows hash exactly as they did. R-000182 is the record.
--
-- A restrictive change must not begin with an edit to this file. There are two acceptable ways
-- to make one. The first is to put the new rule in checkin.js, where it binds only new writes.
-- The second is to run a real migration and record it as a row of `type: decision`. Quietly
-- tightening a CHECK turns every row written before it into a validation failure the next time
-- anyone builds.
--
-- CHANGELOG
--   2026-09-26  +type 'requirement', +columns 'statement' and 'feature', +view
--               'requirements_in_force' (owner). All of it is ADDITIVE, and no migration is needed
--               here or in an adopting project. A requirement is one testable statement of what
--               must be true of the product. R-000181 decided that requirements are records rather
--               than a spec document, and R-000182 built them. 'statement' holds the requirement's
--               current text, and 'feature' groups requirements by what the product does. Both
--               are nullable, and both are in SPARSE_FIELDS, so no existing row's line or chain
--               value changes. The CHECKs below that require them on a requirement, and refuse
--               them on every other type, are conditioned on the new type value or bind only the
--               new columns, so no existing row can violate them. The same record added a third
--               kind to 'related', 'implements', which checkin.js enforces.
--   2026-09-24  +column 'chain', NOT NULL, holding the sha256 value that links each row to the
--               row before it (owner). This change is RESTRICTIVE, and it is the first change
--               that no existing store can absorb as it stands. The value is derived from the
--               preceding row, so it cannot be given a default, and no existing row carries one.
--               Every store written before this date therefore stops loading until it is
--               rebuilt. SCHEMA_VERSION rising from 0 to 1 announces that, and 'jtrek migrate'
--               does the rebuilding. R-0036 is the record for the column and describes how the
--               hash is computed. R-000153 is the decision on how an adopting store reaches a new
--               schema, and R-0009 is the record for the version number that tells it to.
--               The column is not the whole check. A CHECK here binds one row and cannot see the
--               row before it, so this constraint verifies only that the value is a sha256 value
--               written in hex. Whether it is the RIGHT value is decided by the 'chain' group of
--               'jtrek check', which reads the whole file in order. That division of labour is
--               why a nullable column was rejected. A nullable column would make the comparison
--               no easier, because that comparison can never be made in SQL. NOT NULL, however,
--               refuses a row that omits the field. A row appended by hand omits it, because
--               whoever types it computes no hash at all.
--   2026-09-24  'related' is a JSON OBJECT mapping a kind of relation to an array of ids.
--               Earlier the same day it had been an array of bare ids (owner). This change is
--               ADDITIVE, like the entry below it, and NO MIGRATION IS NEEDED ANYWHERE. The array
--               form was never committed or shipped, and one record in this store used it.
--               R-000151 is the decision. The reason for the change is that the kind of relation
--               turned out to be a search term after all. R-0031 asked for the column so that a
--               question such as "which defects wait on R-0039?" could be answered by a query.
--               Bare ids cannot tell a dependency from a cross-reference, so answering that
--               question still meant opening every prose file. Moving the kind into the row also
--               removed three things: the lines in prose files that tagged each id with its kind,
--               the parser that read those lines, and the check that kept them and the row in
--               step. None of those can now drift.
--   2026-09-24  +column 'related', nullable, holding a JSON array of ids (owner). This change is
--               ADDITIVE, and it needs no migration anywhere. Six of the fourteen existing
--               columns were already nullable, so a fifteenth nullable column accepts every row
--               in every store unchanged. That is the opposite of 'detail_ref' below, which was
--               made restrictive and required a rewrite. The column records a relation that
--               OWNS NEITHER record. By contrast, 'supersedes' marks its target as replaced, and
--               'split_from' is written when a parent is broken up. 'jtrek checkin' therefore
--               does not require the target to be in the checkout. At this stage the kind of
--               relation and its reasoning lived in the prose file, as a 'depends on:' or
--               'related to:' line, and a check in 'jtrek check' asserted that the two copies
--               agreed. The entry above replaced that arrangement. R-000138 is the record, and it
--               answers R-0031.
--   2026-09-21  +status 'planned', which MUST carry a note (owner). Both halves of this change
--               are ADDITIVE. Widening the list of statuses invalidates no row, because every row
--               already carries one of the five statuses the list admitted. The requirement for a
--               note binds only rows that use the new value, and no store holds any. No migration
--               is needed, here or in an adopting project. 'planned' means a direction that is
--               settled but cannot be started yet. 'open' claims that the work can start now, and
--               'deferred' claims that a nameable condition is in the way. 'planned' claims
--               neither. The note carries the settled direction, which is the only thing that
--               separates a planned row from an idea nobody has thought through. R-0028 is the
--               record.
--   2026-09-20  'detail_ref' is NOT NULL and must not be empty (owner). This change is
--               RESTRICTIVE, and it required a migration. R-0123 had already made 'jtrek checkin'
--               refuse a row that names no prose file, so the rule existed before this change.
--               However, it bound a row only at the moment the row was written. A hand edit, a
--               merge resolved by hand, or a store written by an older jtrek could still carry a
--               null past it. This store held 175 such rows across 96 records, all written before
--               that rule. They were filled in IN PLACE under the exception to R1 recorded as
--               R-000133. That record also answers R-0036's question of whether old rows should be
--               exempted or migrated, in favour of migrating them. R-000131 is the record for this
--               change. Any other store holding such rows must do the same before it will load.
--   2026-09-18  'id' and 'split_from' accept 'R-' followed by AT LEAST four digits, where both
--               had required exactly four (owner). This change is ADDITIVE. Every row already
--               written has four digits, so none is invalidated and no migration is needed. The
--               old rule capped a store at 9,999 records. At that point 'jtrek checkout' would
--               have offered 'R-10000' as the next free id while this CHECK refused it, so the
--               store could not have added another record at all. jtrek now pads new ids to six
--               digits, so a store holds ids of both widths. As a result, NOTHING may order ids
--               as text any more, because 'R-000124' sorts before 'R-0123' that way. Order them
--               by CAST(substr(id, 3) AS INTEGER) instead. R-000124 records the whole change.
--   2026-08-17  'in-progress' MUST carry a note (owner). The status was redefined to mean that a
--               session ended with the record unfinished, so the note is where to resume. This
--               change is RESTRICTIVE. Five rows already in the store were edited in place to make
--               it possible to add, which is an exception to R1 recorded as a decision record.
--   2026-08-09  +status 'deferred', which MUST carry a note (owner). Both 'open' and 'abandoned'
--               were being used for parked work. As a result, asking the store what is open,
--               which is the question the store exists to answer, returned items that nobody
--               could start. The note is what separates work parked on a stated condition from
--               work that was quietly forgotten.
--   2026-08-09  +type 'question', which is additive. BACKLOG.md, the backlog of the project this
--               schema was first written for, said that its open questions are "not tasks until
--               answered". Filing them as tasks misreports them.
--   2026-08-08  Initial schema.

CREATE TABLE records (
  -- identity ---------------------------------------------------------------
  -- An id is 'R-' followed by AT LEAST four digits. The width is not fixed. This store's early
  -- records have four digits, jtrek pads new ids to six, and neither rule caps how many records a
  -- store may hold. Widening the old four-digit rule accepts every row already written, so the
  -- change was additive. R-000124 is the record.
  id         TEXT    NOT NULL CHECK (length(id) >= 6 AND substr(id, 1, 2) = 'R-'
                                     AND NOT substr(id, 3) GLOB '*[^0-9]*'),
  rev        INTEGER NOT NULL CHECK (rev >= 1),
  ts         TEXT    NOT NULL CHECK (ts GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),

  -- classification ---------------------------------------------------------
  -- 'question' marks an owner decision that has not been answered yet. BACKLOG.md, the backlog of
  -- the project this schema was first written for, said under its own heading that such questions
  -- are "not tasks until answered". Filing one as a task therefore misrepresents it.
  --
  -- 'requirement' is one testable statement of what must be true of the product, kept as a record
  -- rather than in a spec document (R-000181). It is 'open' while proposed, 'done' while in force,
  -- 'done' with outcome 'superseded' once another requirement replaces it, and 'abandoned' when it
  -- is dropped with nothing in its place.
  type       TEXT    NOT NULL CHECK (type   IN ('task','decision','bug','change','question',
                                                'requirement')),
  -- 'deferred' means that the work is still wanted, but something must change before it can
  -- start. The note says what that is. The test that separates it from 'abandoned' is whether
  -- anyone can name the condition that would restart the work. If someone can, the record is
  -- deferred. If nobody can, the work was decided against.
  --
  -- 'planned' means a direction that is SETTLED but cannot be started yet. It sits between the
  -- two tests above rather than beside them. 'open' claims that the work can start now, and
  -- 'deferred' claims that a nameable condition is in the way. 'planned' claims neither. Nothing
  -- outside the record has to change before the work could begin. It is simply not the thing to
  -- do now.
  --
  -- A planned record is not a scratchpad. It is settled and FULLY SPECIFIED. What it lacks is the
  -- ability to start, not a specification. An idea too unformed to state in a row is not a record
  -- at all, and it does not enter the store. R-0056 rejected an inbox for such ideas. The note is
  -- what carries the settled direction, which is why one is required below.
  status     TEXT    NOT NULL CHECK (status IN ('open','in-progress','planned','done',
                                                'abandoned','deferred')),
  outcome    TEXT             CHECK (outcome IS NULL OR
                                     outcome IN ('adopted','rejected','superseded')),

  -- content ----------------------------------------------------------------
  title      TEXT    NOT NULL CHECK (length(trim(title)) > 0),
  -- statement holds a requirement's exact current text: what must be true, and under what
  -- conditions. The title is only a short name for it, and the note says why the revision exists.
  -- feature names the group of requirements that together describe one thing the product does,
  -- such as 'check-in'. A feature is not a unit of work, and it outlives any plan section. Both
  -- columns belong to 'requirement' rows only, and the constraints below say so.
  statement  TEXT,
  feature    TEXT,
  plan       TEXT,                      -- a plan section's slug, e.g. 'plan-surface'
  -- detail_ref names the record's prose file, for example 'records/R-0142.md'. The prose lives
  -- outside the row. One file serves every revision of a record, so a later revision carries the
  -- same path forward rather than naming a new file.
  --
  -- Since 2026-09-20 the field is NOT NULL, and that change was RESTRICTIVE. `jtrek checkin` has
  -- refused a row with no prose file since R-0123, so no row written through the loop could
  -- violate the new constraint. What it newly binds is a row that reached the file some other
  -- way. This store held 175 rows without a `detail_ref`, all written before that rule, and they
  -- were filled in place under the exception to R1 that R-000133 records. Any OTHER store
  -- carrying such rows will fail to load until it does the same. Whether the path names a file
  -- that exists is still checked by `jtrek checkin` and by `jtrek check`, and not here, because
  -- a CHECK cannot look at the filesystem.
  detail_ref TEXT    NOT NULL CHECK (length(trim(detail_ref)) > 0),
  note       TEXT,                      -- why THIS revision exists

  -- relationships ----------------------------------------------------------
  -- supersedes is a JSON array of the ids this row REPLACES. The records it names are finished
  -- with.
  supersedes TEXT             CHECK (supersedes IS NULL OR
                                     (json_valid(supersedes) AND
                                      json_type(supersedes) = 'array')),
  -- split_from names the ONE parent this record was broken out of, and that parent stays ALIVE.
  -- It is a single id rather than an array. Only the child stores the link, and a parent's
  -- children are found by searching for it.
  split_from TEXT             CHECK (split_from IS NULL OR
                                     (length(split_from) >= 6 AND substr(split_from, 1, 2) = 'R-'
                                      AND NOT substr(split_from, 3) GLOB '*[^0-9]*')),
  -- related lists ids that this record touches without owning, GROUPED BY THE KIND of relation.
  -- Both records stay ALIVE, and neither is rewritten. That is what separates this field from the
  -- two above.
  --
  -- The value is a JSON OBJECT that maps each kind to an array of ids, for example
  -- {"depends_on":["R-0039"],"related_to":["R-0104"]}. The kinds are the vocabulary that
  -- checkin.js enforces. An array of ids without kinds is REFUSED.
  --
  -- The kind is stored in the row because it is a search term. R-000138 rev 1 denied that, and
  -- R-000151 corrected it. The case R-0031 made for having the column at all was that R-0039 had
  -- five defects waiting on it and no query could list them, and "waiting on" is a kind. With
  -- bare ids, a search backwards from R-0039 returns every record that touches it and cannot tell
  -- a dependency from a cross-reference. Answering the question still meant opening each prose
  -- file, so the column did not answer the question it was built for.
  --
  -- The link runs in ONE DIRECTION, as split_from does. Only the record that discovers the
  -- relation stores the id. A search backwards runs over that stored side:
  --   by kind:  EXISTS (SELECT 1 FROM json_each(related, '$.depends_on') WHERE value = 'R-0142')
  --   any kind: EXISTS (SELECT 1 FROM json_tree(related) WHERE value = 'R-0142')
  -- json_each over an OBJECT is shallow. It yields the arrays and not the ids inside them, so the
  -- form that searches every kind needs json_tree. This was confirmed by trying it, and the
  -- json_each form returns nothing without any error. Writing the link on both records would
  -- force the target into the checkout and write it a revision that says nothing new, which is
  -- the cost checkin.js exists to avoid.
  related    TEXT             CHECK (related IS NULL OR
                                     (json_valid(related) AND json_type(related) = 'object')),

  -- provenance -------------------------------------------------------------
  files      TEXT             CHECK (files IS NULL OR
                                     (json_valid(files) AND json_type(files) = 'array')),
  source_ref TEXT,                      -- e.g. 'BACKLOG.md#B1@4484234', pinned to a commit

  -- integrity --------------------------------------------------------------
  -- chain is the sha256 of the previous row's chain value followed by this row's own fields, in
  -- the order they are declared above, with the chain field itself left out. 'statement' and
  -- 'feature' are also left out of a row in which they are null, for the reason the header of this
  -- file gives under CHANGING THIS SCHEMA. The first row in a
  -- store is chained to a fixed seed, CHAIN_SEED in src/store.js. Together the values tie the
  -- file's ORDER and its CONTENT to each other. Altering a row, deleting one, or putting one where
  -- it was not all change what the value of some later row should be.
  --
  -- The column adds one thing that 'jtrek check' did not already have. That command compares the
  -- file against git, which catches alteration, deletion, insertion and reordering of rows that
  -- are already committed. However, it cannot tell a genuine append by check-in from a
  -- well-formed line typed at the end of the file, because both are additions at the end of the
  -- file and nothing else. This column closes that one case, because an appended line has to
  -- carry a value derived from the row before it.
  --
  -- It proves nothing about who wrote a row, and it is not meant to. 'jtrek checkin' and a shell
  -- command appending a line run as the same user, on the same machine, with the same access to
  -- read the file. Nothing used here is therefore unavailable to a forger. The question the
  -- column answers is not whether check-in wrote this row, but whether this is the row check-in
  -- would have written. R-0036 records why only the second of those questions can be decided.
  --
  -- No session writes this field. 'jtrek checkin' computes it as it appends, and 'jtrek migrate'
  -- computes it as it rebuilds. A value in work.json is ignored, exactly as 'rev' and 'ts' are.
  chain      TEXT    NOT NULL CHECK (length(chain) = 64 AND NOT chain GLOB '*[^0-9a-f]*'),

  -- A deferred record must say WHY it is parked. Without this constraint, 'deferred' becomes the
  -- place where things go to be quietly forgotten. BACKLOG.md named that failure: "a finding that
  -- lives only inside the story of the day it was found is one nobody schedules."
  --
  -- Since 2026-08-26 the CHECK is unchanged, but the reason it earns its place has changed. This
  -- comment used to justify it by a case that can no longer arise. It said that the reason must
  -- be on EVERY deferred revision rather than only on the revision that parked the record. An item
  -- parked at rev 3 and revised at rev 4 while still deferred would otherwise leave rev 4 as the
  -- current row with the reason blank. That blank would show in the views build.js and handoff.js
  -- produce, which are the two that people read. R-0062 removed that case outright rather than
  -- guarding against it. checkin.js refuses any revision of a deferred record except one that
  -- CHANGES its status, so while an item is parked, the revision that parked it is its current
  -- row. The constraint still binds that one row, and that row is the one that must say why.
  --
  -- The rule that a parked record takes no other revision cannot live here. It compares a row to
  -- the row before it, and a CHECK binds one row. The list at the bottom of this file names it.
  CONSTRAINT deferred_needs_note CHECK (status <> 'deferred' OR
                                        (note IS NOT NULL AND length(trim(note)) > 0)),

  -- 'planned' carries the same requirement, for a different reason. A deferred row needs its note
  -- to name the CONDITION. A planned row needs its note to state the SETTLED DIRECTION, because
  -- that direction is the only thing that distinguishes a planned record from an idea nobody has
  -- thought through. Without the note, the status becomes the scratchpad that the comment on the
  -- status column forbids, and a later session could not tell the two apart from the row alone.
  --
  -- This constraint was ADDITIVE, as deferred_needs_note above also was, and unlike
  -- in_progress_needs_note below. No row in any store carried 'planned' when this constraint was
  -- added, because the value did not exist until this schema.
  -- Nothing had to be rewritten to make it possible to add, here or in an adopting project.
  CONSTRAINT planned_needs_note CHECK (status <> 'planned' OR
                                       (note IS NOT NULL AND length(trim(note)) > 0)),

  -- 'in-progress' does NOT mean that somebody is working on the record. It means that A SESSION
  -- ENDED WITH THIS RECORD UNFINISHED, and the note says where it stopped and what comes next. A
  -- session that ends normally leaves no such record behind, and that is what makes a search for
  -- `status = 'in-progress'` a trustworthy list of work to resume. The note is therefore the
  -- evidence for the status rather than a comment added to it. If there is nothing to say about
  -- where the work stopped, then nothing was interrupted, and the status is wrong.
  --
  -- This constraint was RESTRICTIVE, and history had to be edited before it could be added. A
  -- CHECK binds every ROW, not only each record's current row. The mistake to avoid here is to
  -- reason about each record's current state instead of about every line in the log. The store
  -- this schema was first written for held five rows at rev 1 that carried 'in-progress' with no
  -- note. They had been imported before the status had this meaning. Appending a correcting
  -- revision left those rows in place, so the CHECK refused to load the store. The owner chose to
  -- add a note to those five lines in place, against R1, and recorded the exception as a decision
  -- record. Any OTHER store carrying such rows will fail to load until it does the same. Schema
  -- versioning exists to handle that case.
  CONSTRAINT in_progress_needs_note CHECK (status <> 'in-progress' OR
                                           (note IS NOT NULL AND length(trim(note)) > 0)),

  -- A requirement must carry its text, its feature and the plan section it belongs to. Without
  -- the text there is no requirement. Without the feature it drops out of the list of
  -- requirements in force read feature by feature, which is the list that replaces a spec
  -- document. Without the plan value a reader cannot tell which body of work it came from
  -- (R-000181). The constraint is conditioned on the new type value, so no existing row can
  -- violate it.
  CONSTRAINT requirement_needs_statement_feature_plan CHECK (type <> 'requirement' OR
    (statement IS NOT NULL AND length(trim(statement)) > 0 AND
     feature   IS NOT NULL AND length(trim(feature))   > 0 AND
     plan      IS NOT NULL AND length(trim(plan))      > 0)),

  -- Every other type must leave both columns empty. A statement on a task would read as a
  -- requirement that the list of requirements in force never shows. Refusing the columns now keeps
  -- the choice open, because allowing them on more types later is additive, while refusing them
  -- after rows carry them would not be. Both columns are new, so no existing row holds either.
  CONSTRAINT statement_and_feature_only_on_requirement CHECK (type = 'requirement' OR
    (statement IS NULL AND feature IS NULL)),

  PRIMARY KEY (id, rev)
) STRICT;

-- A record is never edited. A change to it APPENDS a row with the next rev. The primary key
-- above therefore also detects collisions. Suppose two sessions both take R-0142 at rev 2 and
-- both write rev 3. The second insert fails here, rather than the store silently gaining two rows
-- that each claim to be current.

CREATE INDEX idx_records_status ON records (status);
CREATE INDEX idx_records_type   ON records (type);
CREATE INDEX idx_records_plan   ON records (plan);
CREATE INDEX idx_records_parent ON records (split_from);

-- Whether a row is stale is derived, and it is NEVER stored. Storing it would mean editing a line
-- that already exists, and that breaks every merge strategy that was tested (§4.3 of the planning
-- document named at the top of this file). It is computed here instead.
CREATE VIEW records_with_stale AS
SELECT
  r.*,
  CASE WHEN r.rev = (SELECT MAX(rev) FROM records WHERE id = r.id)
       THEN 0 ELSE 1 END AS stale
FROM records r;

-- This view holds the current state of every record: one row per id, the one with the highest
-- rev. It is what checkout reads and what build.js renders into registry.md.
CREATE VIEW current_records AS
SELECT * FROM records r
WHERE r.rev = (SELECT MAX(rev) FROM records WHERE id = r.id);

-- This view counts each parent's children, and how many of them are done, for the hierarchy view
-- in registry.md.
CREATE VIEW children_progress AS
SELECT
  p.id                                                   AS parent_id,
  COUNT(c.id)                                            AS children,
  SUM(CASE WHEN c.status = 'done' THEN 1 ELSE 0 END)     AS children_done
FROM current_records p
JOIN current_records c ON c.split_from = p.id
GROUP BY p.id;

-- The requirements in force are the requirement records whose current row is 'done' and not
-- superseded. The list is computed rather than written anywhere, so it cannot drift from the
-- records, and every change to it is versioned by 'jtrek checkin'. It is what a living spec
-- document would give, without a document to keep true by hand (R-000181).
CREATE VIEW requirements_in_force AS
SELECT * FROM current_records
WHERE type = 'requirement'
  AND status = 'done'
  AND (outcome IS NULL OR outcome <> 'superseded');

-- The following rules cannot be enforced here, so checkin.js enforces them. The header of
-- checkin.js lists every rule it checks, and this list names those that most concern the columns
-- above.
--   * A split_from or supersedes link that a revision adds must name a record that is present in
--     work.json. A SQL foreign key cannot express this, because the primary key is (id, rev) and
--     the link names an id alone. A link carried forward from an earlier revision is not checked
--     again (R-0071).
--   * The record such a link names must be written in the same check-in. checkin.js drops a
--     record whose only differences are ts, rev and chain as unmodified, so the named record needs
--     a note. Without one, the parent's timeline goes silent at the moment it was decomposed.
--   * A record already 'deferred' takes no revision except one that CHANGES its status, and the
--     revision that parks a record must give it a detail_ref. Both rules compare a row to the row
--     before it. R-0062 is the ruling, and R-0063 is the implementation.
--   * The kind of each group in 'related' must be one that the vocabulary holds (R-000151). A
--     CHECK cannot iterate over the keys of a JSON object.
--   * 'chain' must be the value that this row's PLACE IN THE FILE produces. The CHECK above
--     verifies only that the value is a sha256 value written in hex. Whether it is the right
--     value depends on the row before it, and so on the whole file in order. The 'chain' group of
--     'jtrek check' answers that question, and R-0036 is the record.
