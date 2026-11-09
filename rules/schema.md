# The record schema

> {{SHARED:generated-banner}}
>
> **jtrek's `schema.sql` is normative and this file explains it.** Where the two disagree the DDL wins and this document is the bug. The file ships inside the jtrek package. A release of jtrek is installed globally with npm, so the file is at `jtrek/schema.sql` under the directory that `npm root -g` prints.
>
> This file says what a record *is*. What a session *does* with one — the check-out/check-in loop and the four rules that bind it — is [`{{RULES_DOC}}`]({{RULES_DOC}}).

---

## 1. What the store is

Every unit of work is **one record**: a task, a bug fixed, a change made, a decision reached, a question waiting on someone. There is no second file to keep in step, because one row with a status column cannot fall out of step with itself.


| Path                | Role                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| `registry.ndjson`   | **The source of truth.** One JSON object per line, append-only.               |
| `registry.md`       | **Generated and committed.** The current state, for humans and for review.    |
| `registry.db`       | **Generated and gitignored.** A SQLite copy, for browsing and ad-hoc queries. |
| `records/R-0142.md` | The long prose for one record — rationale, detail, what was tried.            |
| `work.json`         | The open checkout. Gitignored; see [`{{RULES_DOC}}`]({{RULES_DOC}}).          |
| `.gitignore`        | Written by `jtrek init`, and what makes the two lines above true.            |


**Where that directory is** is answered by `jtrek.json`, which sits at the project root rather than in the store and names it: `{"store": "{{STORE}}"}`. It is not required — a directory called `jtrek/` holding a `registry.ndjson` is found by walking up from the working directory, so a fresh clone needs no setup. `jtrek init` writes the file anyway, because a store under any other name is reachable only by being named. The tool was called jtrack before it was renamed, and a `jtrack.json`, a `jtrack/` store or a `JTRACK_STORE` variable met in the search is refused with a message saying to rename it, rather than read. `jtrek migrate --from-jtrack` renames the files, as §7 says.

The same file carries five optional keys. `instructions` narrows which agent pointer `jtrek agent` writes. `markdown` names further documents for the `markdown` check to read, as an array of paths relative to the project root, where a directory means every `.md` file directly inside it. That check needs no configuration: by default it covers the plan, the spec, the architecture document, the hand-off, `coding-standards.md` and every prose file under `records/`, and the key adds to that default rather than replacing it. Setting the key to `false` switches the check off, and it then reports NOT CHECKED. And `check` postpones named checks of `jtrek check` — `{"postpone": ["history"], "why": …, "until": …}`, where the named check still reports in full and the run exits 0. The names are `history`, `chain`, `references`, `registry-md`, `markdown` and `plan`. ⚠️ **`why` and `until` are refused as absent rather than defaulted, and an unknown name is refused rather than ignored**, so a postponement always states what it is for and which record removes it, and a typo cannot read as a postponement that postpones nothing. And `thresholds` holds the two session thresholds, in tokens, which `jtrek agent install` writes into the session document. And `cross_review` names the reviewer that `jtrek cross-review` starts: `{"agent": "codex", "writer_family": "anthropic", "reviewer_family": "openai", "model": …}`, where `agent` is `claude`, `codex`, `gemini` or `agy` and `model` is optional. ⚠️ **`jtrek cross-review` refuses to start a reviewer when the block is absent, lacks one of the first three keys, gives a family that is not text or holds only spaces, names another agent, or gives both families the same name**, ignoring letter case and spaces at either end, because a reviewer of the writer's own family tends to share the writer's blind spots.

⚠️ **Line 1 of `registry.ndjson` may be a header rather than a record** — `{"jtrek_schema":1}`, the store's format version. §7 says what it is for, and what to run when a store stops loading.

`schema.sql` is loaded into an **in-memory** SQLite database on every run, built fresh from `registry.ndjson`. That is what makes staleness structurally impossible: there is no persisted index that can drift, and every record is re-validated on every invocation.

⚠️ **`registry.db` is a view, never an input.** `jtrek build` and `jtrek db` write it from the registry, and deleting it at any time is safe. **Nothing in the tool may read it back** — the moment something does, the store has two sources of truth and the append-only design stops meaning anything. Read it yourself, freely: that is what it is for.

### The two jobs the schema does

1. **Index.** `jtrek query` and `jtrek checkout` read it.
2. **Validator.** `jtrek checkin` inserts the edited records into a fresh database, rolls the transaction back, and appends to `registry.ndjson` only if every constraint passed.

---

## 2. Nothing is ever edited

**Updating a record appends a new line with the same `id` and the next `rev`.** Readers keep the highest `rev` per `id`; every earlier row is history. A correction does not erase the mistake, it supersedes it.

This is not a stylistic preference. Every merge strategy tested broke as soon as an existing line was edited, and pure appends were the only shape that merged cleanly. Two consequences:

- ⚠️ **`stale` is never stored.** It is derived from `rev` by the `records_with_stale` view. Storing it would mean rewriting old lines whenever a record changed.
- ⚠️ **A parent never stores a list of its children.** Children point at the parent and the list is derived by query. Storing both directions is the same drift risk in a different coat.

The primary key `(id, rev)` is therefore also the **collision detector**. If two sessions both check out `R-0142` at `rev 2` and both write `rev 3`, the insert fails rather than producing two rows that each claim to be current.

---

## 3. The fields

### Identity


| Field | Type         | Required | Meaning                                                  |
| ----- | ------------ | -------- | -------------------------------------------------------- |
| `id`  | `R-` + digits | yes     | Stable key for the item. Never reused, never renumbered. |
| `rev` | integer      | yes      | Revision of this item, from `1`, counting up per id.     |
| `ts`  | `YYYY-MM-DD` | yes      | The date **this revision** was written.                  |


⚠️ **An `id` is `R-` followed by at least four digits, and its width is not fixed.** `jtrek checkout` pads a new id to six, so a new project starts at `R-000001`; a store whose earlier records are four digits keeps them, and nothing caps how many records a store may hold. The rule required exactly four digits until 2026-09-18, which capped a store at 9,999 — and at that point `jtrek checkout` offered `R-10000` while the schema refused it, so the store could add no further record.

⚠️ **Nothing may order ids as text.** Compared as text `R-000124` sorts before `R-0123`, which is the wrong way round. Order by `CAST(substr(id, 3) AS INTEGER)` in SQL, or by `compareIds`, which jtrek's own `src/store.js` exports, in JavaScript.

`rev` is per-`id`, not global. A new item starts at `rev: 1` whatever else is in the store, and a parent reaching `rev: 4` says nothing about its children.

### Classification


| Field     | Values                                                     | Required | Meaning |
| --------- | ---------------------------------------------------------- | -------- | ------- |
| `type`    | `task` · `decision` · `bug` · `change` · `question` · `requirement` | yes      | What kind of item the record is: work intended (`task`), a fix (`bug`), a chosen product change (`change`), a conclusion reached (`decision`), a decision or answer someone owes (`question`), or a testable statement of what the product must do (`requirement`). |
| `status`  | `open` · `in-progress` · `planned` · `deferred` · `done` · `abandoned` | yes      | Where the item stands: startable now (`open`), left unfinished when a session ended (`in-progress`), settled but not to be started yet (`planned`), waiting on a named condition (`deferred`), finished (`done`), or decided against (`abandoned`). |
| `outcome` | `adopted` · `rejected` · `superseded`                      | no       | How a decision ended (`adopted` or `rejected`), or that the record was replaced (`superseded`). |


**`type` is what stops one kind of entry misreporting another.** A decision is not a task: a task is work you intended, a decision is a conclusion you reached. "Renaming the database was investigated and dropped", filed as an abandoned task, misreports it — it was never attempted work, it was an answer.

- **`task`** — work intended or done.
- **`bug`** — something was broken; this record is the fix.
- **`change`** — an intentional product change, chosen rather than forced.
- **`decision`** — a conclusion reached, including approaches considered and rejected. Carries an `outcome`, and its reasoning in `records/`.
- **`question`** — a decision someone owes that has not been answered. It becomes something else once it is. `jtrek handoff` reports open questions as the work needing a person.
- **`requirement`** — one testable statement of what the product must do, in `statement`, grouped by `feature`. It is `open` while proposed, `planned` once the owner has agreed to it, `done` while in force, superseded when replaced, and `abandoned` when dropped. It reaches `done` only with a passing test: `files` names the test file, the test names its id, and the `tests` group of `jtrek check` fails when either is missing.

**The statuses, and the lines between them:**


| status        | means                                                  | `note`                |
| ------------- | ------------------------------------------------------ | --------------------- |
| `open`        | nothing is stopping this; it can be started now        | —                     |
| `in-progress` | **a session ended with this unfinished**               | see [`{{SESSION_DOC}}`]({{SESSION_DOC}}) |
| `planned`     | the direction is settled, but it is not startable yet   | **required**          |
| `deferred`    | we still want it, but something must change first      | **required**          |
| `done`        | finished                                               | —                     |
| `abandoned`   | we decided not to do it — a conclusion, not a schedule | —                     |


🔑 **`in-progress` is an exception marker, not a resting state.** It does not mean "somebody is working on this"; it means a session stopped partway and the `note` says where. A session ending normally leaves none behind, which is what makes `status = 'in-progress'` a trustworthy resume query. The procedure is [`{{SESSION_DOC}}`]({{SESSION_DOC}}).

🔑 **`planned` claims neither of the things the statuses beside it claim.** `open` claims the work can start now; `deferred` claims a nameable condition is in the way. A planned record claims neither, so nothing has to change before it could begin — it is simply not next.

⚠️ **It is not a scratchpad.** A planned record is settled and fully specified; what it lacks is startability, not specification. Its required `note` carries that settled direction, which is the only thing telling it apart from an idea nobody has thought through.

🔑 **The test between `deferred` and `abandoned` is whether you can name the condition that would restart it.** If you can, it is deferred and the condition goes in the `note`. If you cannot, it was decided against — `abandoned`, usually with `outcome: rejected`.

⚠️ **`deferred` requires a non-empty `note`, enforced by the schema.** A parked item whose condition is invisible cannot be told from a forgotten one. The rule binds **every** deferred revision, not only the one that parked it, because `registry.md` renders current rows — a reason living on the transition revision alone would show there as a blank.

**`outcome` applies mainly to `decision`.** The other use is `superseded`, on a parent whose children now cover it entirely (§4) or on a replaced requirement.

### Content


| Field        | Required | Meaning                                                            |
| ------------ | -------- | ------------------------------------------------------------------ |
| `title`      | yes      | One line, non-empty. What the item is.                             |
| `statement`  | no       | A requirement's text. Required on a `requirement`, refused elsewhere. |
| `feature`    | no       | It names a feature of `{{SPEC_DOC}}` by its slug. Same rule.       |
| `plan`       | no       | It names a section of `{{PLAN_DOC}}` by its slug.                  |
| `detail_ref` | yes      | Path to the prose, e.g. `records/R-0142.md`.                       |
| `note`       | no       | **Why this revision exists.** It is required on every `deferred` and `in-progress` revision, and on a revision that changes no other field. |


**A `plan` value is the slug that begins its section's heading**, as in `## plan-surface — The plan surface`, and it never changes once chosen. A `requirement` must have one. `jtrek migrate --plan-slugs` renames rows still naming a number such as `§5`, and its `--help` says how. `jtrek plan check` fails when a value names no section, or two sections share a slug. A `feature` value is a slug of the same form, naming a feature's heading in the spec. `jtrek check` fails when one names no heading. A feature belongs to one plan section: `jtrek check` fails when its requirements, other than abandoned or superseded ones, name different `plan` values.

⚠️ **`detail_ref` resolves against the store directory, not the project root.** Entries like `../docs/design.md` are ordinary, and resolving them from the wrong base reports false failures. The trap is that jtrek uses **two** bases: a `detail_ref` resolves against the store, while an entry of the `markdown` key in `jtrek.json` resolves against the project root, because such an entry names a document anywhere in the repository. Swapping them fails in both directions.

{{SHARED:prose-file-rule}} The column is `NOT NULL`, so a store holding a row without one does not load at all. One file serves every revision of a record, so a later revision carries the same path forward.

⚠️ **And one file belongs to one record.** `jtrek checkin` refuses a `detail_ref` another record already names, and `jtrek check` reports it. Where a record needs prose another holds, link to it from that record's own file: a pointer is not a duplicate.

📌 **`jtrek checkin` resolves `detail_ref` and refuses a value that points at nothing**, so the mistake above is caught before the row is written rather than by `jtrek check` afterwards. The refusal spells out the corrected value when the path is merely prefixed with the store's own directory name. The check sits in check-in rather than in `jtrek check` because `jtrek check` resolves every revision rather than each record's current one, so a bad path that reaches the registry cannot be repaired by a later revision.

🔑 **What belongs in a `note` is decided by whether it has to be findable, rather than by its length.** `jtrek query` searches the rows and never opens the prose files, so anything a later session would search for has to be in the row, however long that makes the row. What a session reads after it has found the record, rather than what makes the record findable, goes in the prose file `detail_ref` names.

**A `note` is required in three cases**, and only these:

1. **Every `deferred` revision** — enforced by `schema.sql`, so the store will not even load without it.
2. **Every `in-progress` revision** — enforced by `schema.sql`, and additionally refused by `jtrek checkin` with a clearer message. The note is the resume point, and a status meaning "a session stopped here" without one is a stop that was half made.
3. **A revision whose other fields are all unchanged** — enforced by `jtrek checkin`, which otherwise drops the revision as unmodified and the record's timeline goes silent. The main instance is a parent being written because a child was split out of it (§4).

⚠️ **A `CHECK` binds every row, not every record — and that is the trap here.** A store may hold `in-progress` rows written before the status carried this meaning. Correcting those records appends a revision; it cannot rewrite the original row, because the log is append-only. So the old rows remain, and adding this constraint to a store containing any of them **stops the store loading at all**. Reasoning about the fold rather than the log is how that gets missed: a store can show zero current `in-progress` records while holding a dozen such rows.

An older store therefore has to be dealt with before this constraint can be adopted — which is precisely what §7's schema versioning exists to make survivable.

🔑 **Prose lives outside the row, so that it diffs as prose.** A row is one line. A revision adds a new line and git shows that line whole, so a reader of the diff cannot see what changed since the previous revision without comparing the two rows. A prose file spreads over many lines, and git shows only the lines that changed. ⚠️ **Findability still decides what goes in the `note`, so a row can run to a few kilobytes**, and that cost is accepted.

### Relationships


| Field        | Shape                       | Meaning                                                          |
| ------------ | --------------------------- | ---------------------------------------------------------------- |
| `supersedes` | array of ids                | Those records are **replaced**; this one takes over from them.   |
| `split_from` | one id, or null             | This is a piece broken out of that parent.                       |
| `related`    | kind to ids, or null        | This record touches those, and neither of them is replaced by it. |


See §4, which is the part most easily got wrong.

**`related` groups its ids by the kind of relation**, as a JSON object. The list of kinds is closed: one outside it stores perfectly well and is then skipped by every search that asks for a kind.

```json
"related": {"depends_on": ["R-0142"], "related_to": ["R-0200"], "implements": ["R-0201"]}
```

`depends_on` says this record came out of that one; `related_to` says the two bear on each other; `implements` names a requirement this task meets. Why belongs in the prose file.

**Only the record that discovers the relation lists the id**; the other is left untouched. Searching the other way runs over the stored side:

```bash
jtrek query --query "EXISTS (SELECT 1 FROM json_each(related, '$.depends_on') WHERE value = 'R-0142')"
jtrek query --query "EXISTS (SELECT 1 FROM json_tree(related) WHERE value = 'R-0142')"
```

The first asks what depends on `R-0142`, the second what touches it at all. ⚠️ **The second needs `json_tree`**, because `json_each` over an object is shallow — it returns each kind's array rather than the ids inside it, so a `json_each` form silently matches nothing.

### Provenance


| Field        | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `files`      | Array of repository paths this record touched. Optional.       |
| `source_ref` | Where this record came from, **pinned to a commit**. Optional. |


`source_ref` looks like `BACKLOG.md#B1@4484234`. Use it whenever a record is derived from something outside the store — a ticket, a specification, a document being migrated into records. The commit pin is not decoration: an origin file may be edited or deleted, so an unpinned reference stops resolving while a pinned one stays readable through `git show`.

### Integrity


| Field   | Meaning                                                                              |
| ------- | ------------------------------------------------------------------------------------ |
| `chain` | The sha256 linking this row to the one before it. Required, and never written by you. |


**The value is the hash of the previous row's `chain`, followed by this row's own fields in their declared order with `chain` itself left out.** `statement` and `feature` are also left out while null, so adding them changed no existing row's value. The first row in a store is chained to a fixed seed. Together the values make the file's order and its content one thing: altering a row, deleting one, or putting one somewhere it was not all change what some later row's value should be.

⚠️ **No session writes this field.** `jtrek checkin` computes it as it appends and `jtrek migrate` as it rebuilds, and a value written into `work.json` is ignored exactly as `rev` and `ts` are.

**What it detects is the one case git cannot see**: a well-formed line typed at the end of the file, which is indistinguishable from a genuine check-in in a diff and which carries no hash at all. 📌 It proves no authorship and is not meant to — the question it answers is *is this the row check-in would have written*, rather than *did check-in write it*.

⚠️ **The `CHECK` in `schema.sql` verifies only that the value is a sha256 in hex**, because a `CHECK` binds one row and cannot see the row before it. Whether the value is the right one is the `chain` group of `jtrek check`, which reads the whole file in order.

---

## 4. The four ways records relate


| Relationship           | Expressed by            | What it says about the other record                                                     |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------------------- |
| Same item, later state | same `id`, higher `rev` | it is history                                                                           |
| Replacement            | `supersedes: [ids]`     | it is finished with; this record takes over                                             |
| Break-out              | `split_from: "R-0142"`  | it can be finished with or still tracked (see below); either way, this is a piece of it |
| Connection             | `related: {kind: [ids]}` | it stands untouched; this record depends on it, bears on it, or implements it          |


**The first three write the other record a revision and the fourth does not**, which is why `related` alone needs no checkout.

**`split_from` exists because doing more work on an item does not always replace it.** Breaking a large item into pieces leaves the parent standing as a thing to report on. `supersedes` cannot say that — it would retire the parent — so a second, scalar field carries it. A break-out has exactly one origin; a replacement can absorb several records, which is why one is scalar and the other an array.

### ⚠️ A split always writes a new revision of the parent, and its status depends on the case

**The parent is not automatically left `open`.** Which case you are in decides it:

- **The children cover the parent entirely** → the parent's new revision is **`status: done`**, `outcome: superseded`, with a `note` naming the children that cover it. There is nothing left under the parent's own id, and leaving it open would overstate what is outstanding.
- **The children are partial, or derivative of a parent that continues** → the parent **keeps its status**, and the new revision exists purely to record that a break-out happened, carried in the `note`.

The second case is exactly why a `note` is mandatory on an otherwise-unchanged revision. With no other field different the row is identical to its predecessor, `jtrek checkin` drops it as unmodified, and the parent's timeline goes silent at the precise moment it was decomposed.

---

## 5. The views

These are SQL views declared in `schema.sql`. They exist in the in-memory database every command builds, and `jtrek build` copies them into `registry.db` — so they are also what you query when you open that file in a database browser.


| View                 | What it gives you                                              |
| -------------------- | -------------------------------------------------------------- |
| `records_with_stale` | Every row, plus a derived `stale` flag (`0` = current).        |
| `current_records`    | One row per id, highest `rev` wins. **Query this by default.** |
| `children_progress`  | Per parent: how many children, how many are done.              |
| `requirements_in_force` | Current `requirement` rows that are `done` and not superseded. |


`current_records` is what `jtrek query` and `jtrek checkout` read and what `jtrek build` renders. `children_progress` is what lets `registry.md` show `R-0142 [in-progress] … (1/2 children done)` instead of a hand-counted figure.

---

## 6. What the schema cannot enforce

Three rules matter and none is expressible in SQL here, so **`jtrek checkin`** owns all three. It also re-checks the `in-progress` note rule, which the schema does enforce, purely to fail with a message naming the fix rather than with a constraint name.

1. **`split_from` and `supersedes` must point at ids that exist *and are present in `work.json`*.** A foreign key cannot express it: the primary key is `(id, rev)` while the reference is to `id` alone. Scoping the check to `work.json` is deliberate — you cannot correctly reference a record whose current state you never read, and both relationship types write the target's next revision anyway. Read it with `jtrek query` and add it to the open checkout with `jtrek checkout --add --id`, or check it out alongside. 📌 **`related` is exempt, and the same sentence is why**: it writes the record it names no revision, so the reason for the rule does not reach it. That a `related` id resolves is checked by `jtrek check` instead.
2. **A revision whose only differences are `ts` and `rev` must carry a `note`** — §3.
3. **A `related` group's kind must be one of the three.** A `CHECK` cannot iterate an object's keys, so check-in enforces it and `jtrek check` catches a row that arrived another way.

Beyond those, `checkin` refuses an `in-progress` record with no `note` before the schema would, so the error says what to do: if nothing was interrupted, the status is wrong and `open` is right.

---

## 7. Changing the schema

**The schema is not frozen.** It was designed from what was known at the time, cases nobody thought of will turn up, and when changing it is the best fix, change it.

⚠️ **But the two directions are not symmetric**, because every command re-validates the entire store on every run. A tightened rule retroactively invalidates every row written under the old one.


| Safe — old rows still load        | Breaks history — old rows rejected  |
| --------------------------------- | ----------------------------------- |
| Add a nullable column             | Add `NOT NULL` with no default      |
| Add a column with a `DEFAULT`     | Remove an enum value                |
| Add an enum value                 | Tighten an existing `CHECK`         |
| Add a `CHECK` on a **new** column | Add a `CHECK` to an existing column |


⚠️ **That right-hand column is a heuristic, not the rule.** The rule is that a change breaks history **if and only if some row already in the store violates it** — and there is one systematic exception worth knowing, because the table would otherwise talk you out of a correct change:

**A `CHECK` conditioned on a new enum value cannot invalidate history.** No historical row can hold a value that did not exist when it was written, so `status <> 'deferred' OR note IS NOT NULL` is vacuously true for every row already stored. A rule of that shape therefore belongs in `schema.sql`, where every command enforces it, rather than in `checkin`, which a hand-edited `registry.ndjson` would bypass.

- **Additive changes are free.** Edit `schema.sql`, rebuild, add a line to that file's changelog. A new nullable column also joins `SPARSE_FIELDS` in `src/store.js`, or every existing row's `chain` changes.
- **Restrictive changes are a migration, not an edit.** Either put the new rule in `checkin` so it binds new writes only and history is left alone, or raise the store format version and migrate — and record either as a `type: decision` record. Quietly tightening a `CHECK` turns every historical row into a validation failure the next time anyone builds, and the failure surfaces far from the change that caused it.
- 📌 **The general escape hatch is schema versioning, and it is built in both halves.** A store states its format version in a header on line 1 of `registry.ndjson`, and nowhere else. **A store carrying no header is version 0**, the format that existed before versioning did, so no store had to be rewritten for versioning to begin. A store that holds no rows and no header is current instead, because nothing in it was written against an earlier schema, and `jtrek migrate` treats it as current too. jtrek refuses a store whose version is not its own, and says which way the mismatch runs: an older store must be rebuilt against the current schema, and a newer one means this copy of the tool is behind and the store must be left alone. **The version is 1**, raised from 0 by the `chain` column described in §3.

- 📌 **A store refused as old is brought up to date by `jtrek migrate`.** It reads what is there, builds a complete new store against the current schema, validates that before touching anything on disk, and then replaces the registry. Every other command reads the store through the check that refused it, so this is the one such a project can still run. It refuses a store already current, a store written by a newer jtrek, and a registry carrying uncommitted changes — the rebuild replaces the file and git is a store's only backup, so commit or stash first. ⚠️ **A migration fails the `history` check**, because rewriting every line is the shape that check reports, and nothing exempts itself from a gate. Commit the rebuild, after which the default comparison against `HEAD` is clean again.
- **A project that adopted jtrack is brought under jtrek's names by `jtrek migrate --from-jtrack`.** The tool was called jtrack before it was renamed. A jtrack store therefore has the names `jtrack/`, `jtrack.json` and `jtrack_plan.md` and its siblings, its header key is `jtrack_schema`, and its chain was computed from the seed `jtrack/chain/v1`. jtrek reads none of those names. The command moves each file to its jtrek name with `git mv`, so git keeps the file's history. A store directory that `jtrack.json` names under its `store` key keeps its name, unless that name is `jtrack`, which `jtrack init` wrote by default. Such a directory moves to `jtrek/`, and the `store` key of `jtrek.json` then names `jtrek`. The command also rewrites the header key and recomputes every row's chain from jtrek's seed, and it changes nothing else in any row. It first verifies the old chain against jtrack's seed, because recomputing it unverified would hide a row that was edited by hand. It refuses a chain that does not verify, a registry whose first line is not JSON, a format version other than 1, a header that already states `jtrek_schema` at a version this jtrek does not read, an open checkout, uncommitted changes to the files it touches, a file it would move that git does not track, a project holding both a jtrack name and anything at its jtrek name, and a result that would not load. In each case it writes nothing. It commits nothing either. The text of the records still says jtrack, and that text is left as it is, because the store is append-only. The command leaves what jtrack installed for the agent, and `jtrek agent install`, which it says to run next, removes that: the block in `AGENTS.md` and `CLAUDE.md`, the hooks in `.claude/settings.json` that run `jtrack guard` and `jtrack threshold`, the nine skills jtrack shipped and `.claude/rules/jtrack.md`. It also corrects the commands named in the comments of the store's `.gitignore`. `jtrek agent --check` fails while any of the block, the hooks, the skills or the rule remains. Neither command touches the user's own Claude Code settings, because another project on the machine may still use jtrack.

---

## 8. A complete record

A parent closed out because two children now cover it, which is the §4 full-coverage case:

```json
{
  "id": "R-0142",
  "rev": 3,
  "ts": "2026-08-08",
  "type": "task",
  "status": "done",
  "outcome": "superseded",
  "title": "Admin type tier",
  "plan": "permissions",
  "detail_ref": "records/R-0142.md",
  "note": "closed out — fully covered by R-0200 and R-0201",
  "supersedes": null,
  "split_from": null,
  "related": null,
  "files": ["docs/design/design.md"],
  "source_ref": "BACKLOG.md#B1@4484234",
  "chain": "9b1e…c40a"
}
```

Every field a record does not use is written as an explicit `null`, in the order above, so the same record serialized today and next year produces byte-identical lines. The `chain` above is abbreviated for reading; a real one is 64 hexadecimal characters, and it is written by jtrek rather than by whoever composed the record.
