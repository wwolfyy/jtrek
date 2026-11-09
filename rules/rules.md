# Tracking work — jtrek

> {{SHARED:generated-banner}}
>
> **This is the only copy of the rules.** `AGENTS.md` and `CLAUDE.md` carry a short pointer to this path rather than a duplicate of it, so there is nothing to keep in step by hand.

**Terms used here are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}), alphabetically.** This file says what a session does with a record. What a record *is* — every field, which of them are required, and the four ways records relate — is [`{{SCHEMA_DOC}}`]({{SCHEMA_DOC}}). Read it before composing a row from nothing.

## What a record is

- Work lives in [`{{STORE}}`]({{STORE}}). **One item, one record.** A bug fixed, a change made, a decision reached, a new task, an owner question — each of those is one record.
- What kind of item it is comes from the `type` field: `bug`, `change`, `task`, `decision`, `question`, `requirement`.
- **A record has two parts:**
  - The **row** — one line in `registry.ndjson` holding `id`, `type`, `status`, `title`, `note` and the other fields. Every record has a row.
  - The **prose file** — `{{STORE}}/records/R-XXXX.md`, named in the row's `detail_ref`. It holds what a session reads after it has found the record, rather than what makes the record findable.
- **Both parts are read by a stranger** — an agent in a session that was not part of the work, has no code open, and found the record by searching. Therefore 1) write full sentences that make sense without seeing the code changes the work made, or the conversation in which it was done, and 2) define the project's own terms — a function, a field, a group of checks — where they first appear. A project's own writing conventions live in `AGENTS.md` or `CLAUDE.md`; these two are requirements of the store and apply on top of what's provided in the two documents.
- **"Record" is a verb here too: to record something is to write its row.**
- {{SHARED:prose-file-rule}} One file serves all of a record's revisions, so revising a record that already has one costs nothing; revising one that does not means writing it first.
- **Changing a record means adding a revision**: a new row with the same `id` and a higher `rev`. Earlier rows stay exactly as they are. Nothing in the store is ever edited or deleted.
- **A record's current state is its row with the highest `rev`.** That is what `jtrek query` returns and what `registry.md` shows.

## The loop

Every change to the store goes through these four steps, in this order:

```bash
jtrek query --query "status = 'open'"   # 1. look. Reads, and takes nothing
jtrek checkout --id R-0142              # 2. take the work. --new for an empty checkout
#    edit {{STORE}}/work.json
jtrek checkin                           # 3. write the rows to registry.ndjson
jtrek build                             # 4. regenerate registry.md
```

## The four rules

**Nothing enforces these four. Their wording is the entire mechanism. You must obey them.**

- **R1 — jtrek writes the registry, and a person never does.**
  - Never hand-edit `registry.ndjson`. jtrek writes every line in it, and the loop below is how a session gets a row written.
  - To fix a mistake, add the next revision. Never edit the row that was wrong.
  - To start an item with nothing checked out, run `jtrek checkout --new`.
  - To add an item while a checkout is already open, append it to the `records` array in `work.json` and take its id from `next_free_id`. You do not need to check in first.
  - ⚠️ **That covers a NEW item only. R4 says when this comes up and what to do about it. A record that already exists is never appended by hand.** For an existing record, `next_free_id` is not its id -- if it is not already checked out, retrieve its current state and earlier notes with `jtrek checkout`, or with `jtrek checkout --add --id` while a checkout is open, and record a revision of it.
- **R2 — do not run `jtrek checkin` until the work is finished, prose file included.**
  - `jtrek checkin` versions the row. Nothing versions the prose file.
  - If you check in before the prose is finished, then the row will point at prose that changed afterwards. Nothing in the store records that it changed.
  - Once an item is checked in, the only way to correct it is by adding a revision that carries a `note`. Never correct it silently.
  - The definition of "finished" includes being legible to someone who was not here. Before checking in, re-read the note and the prose against the two requirements under "What a record is".
- **R3 — read the store with `jtrek query`. Never `grep` it.**
  - `jtrek query` reads and writes nothing. `jtrek checkout` takes the work. Use `query` whenever you are only looking.
  - `registry.ndjson` is append-only and JSON-escaped, so `grep` counts superseded revisions that are no longer current, and misses text that is escaped. It is wrong in both directions, and it returns a plausible number either way.
  - You can use `jtrek query` while a checkout is open too, for example to read a record you want to reference.
  - `jtrek query` reads current rows. Read earlier rows with `jtrek history --id R-0142`.
- **R4 — what you find gets its own row, in the same check-out/check-in loop as the work during which you find it.** If not put in a row, that information cannot be found by `jtrek query`. To determine whether to create a row for your finding, **ask three questions, in order.**
  - **1. What does it leave behind?** Where work goes depends on that, not on what kind of work it is. If it affects the project or the store, it belongs in the store, even when it is tooling or git work, so go on to question 2. If it affects only the machine the session ran on, such as a hook installed there, it goes in the hand-off's "Where things stand". If it leaves nothing behind, it is written nowhere.
  - **2. Does it need to be found later by `jtrek query`?** If not, it belongs in the prose of the record it concerns, rather than in a row of its own.
  - **3. Which row covers it already?** ⚠️ **Look in both places** — the records you have checked out, and the rest of the store. `jtrek query` takes nothing and runs perfectly well while a checkout is open, so an existing checkout is never a reason not to look. If you record a duplicate it remains in the store, because a duplicate can only ever be superseded, never removed.
    - ⚠️ **A row counts as covering it only if it passes both of the tests below. Read the row rather than just its title.**
      - **It is about the same thing**, rather than merely produced by the same work. A record this session happened to touch is likely adjacent to what you found, and adjacent is not the same as covering. A finding written onto an adjacent record is stored under a subject it does not belong to, so a later session that searches by subject will not find it.
      - **It is alive.** A row carrying `outcome: superseded` was replaced, so the finding belongs to whatever replaced it, or to a new row. Only the successor stores the link, so find it with `jtrek query --query "EXISTS (SELECT 1 FROM json_each(supersedes) WHERE value = 'R-0142')"`. Revising a superseded row is allowed for one purpose only: to correct that row's own history, i.e. the "outcome" label.
    - What the look turns up is the whole answer:
      - **Nothing covers it** → write a new row, in the checkout you already have.
      - **A row you have checked out** → revise that row. It is in hand, so no second check-out/check-in loop is needed.
      - **A row you have not, and you have nothing to add to it** → do nothing. It is already recorded, and if you add a second row saying the same thing, it remains in the store because it cannot be deleted.
      - **A row you have not, and you have something worth adding to it** → finish the work in hand and `jtrek checkin`. Then check that record out, write the new information into it, and check in again. Two loops, because it is two pieces of work.
  - This rule also applies to work nobody asked for: a defect you noticed, an approach you abandoned, a premise that turned out to be false. A diff shows what changed, and it cannot show what was considered and rejected, so nothing else records it.
  - **A finding you are not going to act on is still a row** — `status: open`.

## Checking out

- **One checkout at a time.** `jtrek checkout` refuses while `work.json` has no `checked_in` stamp, because that file then holds edits that exist nowhere else.
- **A checkout that turned out to need no changes still must close.** Run `jtrek checkin`. It stamps the file and reports that the registry was not touched.
- **Simply referencing a record needs no checkout.** Naming a record in a `note` or in prose is only reading it, so use `jtrek query`.
- **To use** `split_from` **or** `supersedes`**, check out the record that is being split or superseded.** Check-in rejects the link otherwise, because that link changes the other record too.
- **Splitting a record adds a revision of the parent as well.** Which one depends on the case:
  - The children cover the parent entirely → the parent goes `status: done`, `outcome: superseded`, with a `note` naming them. Leaving it open would overstate what is outstanding.
  - The children are partial and the parent continues → the parent keeps its status, and the revision exists only to record the break-out, in its `note`.

## Branches

- **One branch at a time writes records.** Each branch computes the next free id from its own copy of `registry.ndjson`, so two branches that write records at the same time can give one id to two different records. A branch that writes records therefore starts only once the previous one has merged into the project's main branch.
- **A feature is built on its own branch**, named `feature/<slug>` after the feature's slug in the spec. The branch is created from the main branch when the first task of that feature is taken. A later session that takes another task of the same feature switches to the existing branch rather than creating a new one.
- **Switch to the branch before running `jtrek checkout`.** The checkout reads the record and `next_free_id` from the registry on the current branch, and only the feature branch holds the rows written there.
- **A task belongs to the feature of the requirements it implements**, which are the ones named under `implements` in its `related`. Only a requirement carries a `feature` value, so the task's feature is read from them. A task whose requirements name two features is split before work begins, one task per feature. A task that implements no requirement names no feature.
- **While a feature branch is open, a session works only on that feature.** The feature's work includes a bug or a change in the code that the branch added, even though such a task implements no requirement and so names no feature. Every other task waits until the branch has merged, whether it belongs to another feature or names no feature. A finding about other work is still recorded as a row on the branch, as R4 requires, but the work it describes is not done there. The reason is that a review of the feature reads the branch's whole diff, so any other work done on the branch would reach the feature's reviewers as if it were part of the feature.
- **On a feature branch, commit each record as soon as its tests and the gates pass.** The commit holds the record's code, its tests, its rows, its prose file and the regenerated `registry.md`, and its message names the record. The feature's diff then shows the records one at a time, which is what a review of the feature reads.
- **Work that names no feature is done on the main branch, while no feature branch is open.** The owner reviews it when the session closes.
- **A feature branch merges into the main branch only on the owner's go-ahead.** The owner decides when the feature is finished. The session then shows the owner the branch's diff, naming first the changes that would be hard to reverse, such as a change to the store's format or to a test that verifies a requirement in force. It merges without squashing, so that each record's commit survives on the main branch.

## The files, and what you may do to each

- `registry.ndjson`: never touch it by hand. jtrek writes it, and `jtrek checkin` is the verb a session uses. See R1.
- `registry.md`: never touch it by hand. It is generated. Run `jtrek build` whenever a record changed, and commit the result. `jtrek build --check` fails when it does not equal the store.
- `coding-standards.md`: do not read it while writing code. Only the refactoring reviewer reads it, in the review of a finished feature that [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) describes, so that the writing agent's context holds the code it is writing. The project edits it to add its own standards, and `jtrek agent install` never writes to it once it exists.
- `jtrek_spec.md`: write each feature's heading and paragraph, and never the part under its `### Requirements` heading. `jtrek build` writes that part from the requirement records, and `jtrek build --check` fails when it does not equal the store.
- `work.json`: this is the one you edit. Never commit it, and never delete it after a check-in. It is gitignored deliberately.
  - It is the merge-conflict recovery file. When two branches both add a revision of the same record, resolve `registry.ndjson` by taking theirs whole, then run `jtrek checkin` again. Never hand-merge the conflicting lines. The row's content comes from `work.json`, so this works only while that file still holds your intent. The revision number is computed from the registry in front of it, so your row is numbered above theirs with no arithmetic on your part.
  - Reassess before that check-in. The other branch revised the same record, so what it wrote may change what yours should say. Read it with `jtrek query` and bring `work.json` into line with it first.

## Writing the prose file

- **What belongs in the row is decided by whether it has to be findable, rather than by its length.** `jtrek query` searches the rows and never opens the prose files, so anything a later session would search for belongs in the `note`. Everything else goes in the prose file.
- One file per record, shared by all of its revisions.
- Begin with a heading matching the title of the row, then one line of context:

```markdown
# R-0142 — Admin type tier

> **task · in-progress** · 2026-08-17 · plan-surface
```

- Then write three things, in this order:
  - **What the problem is.** First, because it is what a future session reads before deciding whether to read the rest.
  - **What was tried and rejected, and why.** This is the part no diff can reconstruct, and the reason the file exists.
  - **Where it stands.** Last, so an interrupted record can be added to without rewriting anything.
- **Keep it brief.** Write what a stranger needs to understand the record, and name another record rather than restating it. No command measures a document's length, so this instruction is all that keeps the file short.
- **Append to it. Never rewrite it.** Earlier revisions point at this same path, so replacing the contents changes what those revisions say. Correct a mistake by adding a new dated section, as you would correct a row by adding a revision.
- **Naming another record means putting its id in the row's `related`**, under `depends_on`, `related_to` or `implements`, which is what makes the link searchable backwards. Explain it here; the row carries only the id. The record named needs no checkout.

## Sessions

- **Opening one:** run `jtrek start` and follow [`{{OPENING_DOC}}`]({{OPENING_DOC}}). Selection reads and never takes: `jtrek checkout` runs only after the owner has chosen.
- **Closing one:** run `jtrek handoff` and follow [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}).
- **Stopping at the hard threshold:** follow [`{{SESSION_DOC}}`]({{SESSION_DOC}}), which instructs:
  - Append what is done to the prose file.
  - Check the record in at `in-progress`, with a `note` saying where it stopped.
  - Rewrite the hand-off's "Start here" and "Where things stand", run the gates, then stop.
- 🔑 **`in-progress` means one thing: a session ended with that record unfinished.** A session that ends normally leaves none behind.
- **Writing code:** follow [`{{CODING_DOC}}`]({{CODING_DOC}}).

## The plan

- What the work is *for* lives in [`{{PLAN_DOC}}`]({{PLAN_DOC}}), one section per `plan` value in the registry.
- **Progress is not written there.** It is derived from the records naming the section. A box ticked by hand is derived from nothing, so nothing keeps it true once the records move on.
- **Writing or revising it:** follow [`{{PLANNING_DOC}}`]({{PLANNING_DOC}}).
- **In any session, ask the owner before** changing a requirement's `statement`, a section's purpose or the architecture document, or superseding or dropping a requirement.

## The gates

All of these exit non-zero on failure.

**Run all three before every `jtrek checkin`, whatever the work is.** Code also has to pass its tests, as [`{{CODING_DOC}}`]({{CODING_DOC}}) says. Work other than code, such as a decision or a change to a document, has no tests, but it passes the gates before its check-in in the same way. A change to a document can still break what the gates keep true, for example by leaving a structural shape in the plan or by making a generated document differ from its template.

```bash
jtrek check            # the store's own history and references are sound
jtrek build --check    # registry.md and the spec's requirements equal the store
jtrek agent --check    # the generated documents match the installed jtrek
```

`jtrek check` runs eight checks, and names each in its output: **history** — `registry.ndjson` was appended to and never altered; **chain** — every row carries the hash its contents and its position produce, so no row was fabricated, moved or edited; **references** — every `detail_ref`, `supersedes` and `split_from` resolves, no prose file is unreferenced except one that a record in the open checkout names, which the output lists, and a postponement's `until` names a record that exists; **registry-md** — the comparison `build --check` makes, called rather than reimplemented; **markdown** — the store's own prose carries none of the structural shapes an editor leaves when it rewrites a file on save; **plan** — the comparison `jtrek plan check` makes, so every `plan` value names a section of the plan; **spec** — every requirement's `feature` names a heading of the spec, each feature's requirements name one plan section, and what is listed there equals the store; **tests** — every requirement in force names in `files` a file that contains its id.

⚠️ **The markdown group needs no configuration.** It covers the plan, the spec, the architecture document, the hand-off, the coding standards and every record's prose file. A `markdown` key in `jtrek.json` **adds** further documents to that default, and `false` switches the group off, reporting NOT CHECKED. `R-000125` holds the reasoning.

⚠️ **`history` compares the working tree against `HEAD`**, so it catches a hand-edit while that edit is still uncommitted. Cover a whole branch with `jtrek check --since origin/main`.

⚠️ **A check's exit code can be postponed, so read what the command prints rather than only what it returns.** A `check` block in `jtrek.json` — `{"postpone": ["history"], "why": …, "until": …}` — makes the named check report in full and still exit 0, and every run names the postponed checks, a clean run included. `why` and `until` are required, because a gate with no stated reason and no condition that would restore it is off permanently. `until` must also name a record the store holds, which the `references` group verifies, so a postponement cannot point at work nobody wrote.
