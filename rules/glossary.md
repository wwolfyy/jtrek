# Glossary — the terms jtrek's documents use

> {{SHARED:generated-banner}}

This file defines the terms that the rules and the session procedures use and that a reader cannot look up outside this project. It is arranged alphabetically, because it is meant to be consulted when a term is met rather than read from start to finish. Terms any programmer already knows, such as a commit or a branch, are left out.

---

**Architecture document.** `{{ARCHITECTURE_DOC}}` says how the product is built. The planning procedure writes it, and a review of a finished **feature** or plan section compares the code with it.

**Brownfield.** A brownfield project is one that already has code, records or a hand-written plan when planning starts. The planning procedure, `{{PLANNING_DOC}}`, drafts its plan from what exists, and keeps every section slug its records name.

**`check` block.** A `check` block is an optional object in `jtrek.json`, the project's jtrek configuration file, which switches off the exit code of one named check while leaving its report intact. It takes the form `{"postpone": ["history"], "why": …, "until": …}`. What it does and what it requires are set out under **postponement**.

**Check-in.** A check-in is a run of `jtrek checkin`, which reads `work.json` and appends the rows it holds to `registry.ndjson`. It is step 3 of **the loop**, and it is the only thing that writes to `registry.ndjson`. It also stamps `work.json` as checked in, which is what releases the next **checkout**.

**Checkout.** A checkout is a run of `jtrek checkout`, which copies a record's current state into `work.json` so that it can be edited, and which marks that work as taken. It is step 2 of **the loop**. Only one may be open at a time, because there is a single `work.json` holding the checked-out rows, and a second checkout would overwrite it and destroy edits that exist nowhere else. Running `jtrek checkout --new` opens an empty one, for an item that does not exist yet. Running `jtrek checkout --add --id` copies a record that already exists into the checkout that is open, without replacing it.

**Coding standards.** The coding standards are the file `{{STORE}}/coding-standards.md`, which says what good code looks like in this project. `jtrek agent install` creates it from jtrek's base set when it is missing, and the project then adds standards of its own. Only the agent that refactors a finished **feature** reads it. The agent that writes the code does not.

**`cross_review` block.** A `cross_review` block is an optional object in `jtrek.json` that names the reviewer `jtrek cross-review` starts for the cross-family review of a finished feature or plan section. It takes the form `{"agent": "codex", "writer_family": "anthropic", "reviewer_family": "openai"}`, with an optional `model`. The command refuses a block whose two families are the same.

**Current state.** A record's current state is its **row** with the highest **revision** number. That row is what `jtrek query` returns and what `registry.md` shows. The earlier rows stay in `registry.ndjson` unchanged, so a record's current state is a position in that file rather than a replacement of what came before.

**`detail_ref`.** `detail_ref` is the field in a **row** that holds the path of that record's **prose file**. It is required on every row, and `jtrek checkin` refuses a row without it. All of a record's revisions share the one file, so a revision normally carries the same value forward.

**Feature.** A feature is one thing the product does, such as `check-in`. It has a heading in the **spec**, and a **requirement**'s `feature` value names that heading by its slug. Unlike a "feature" in most trackers, it is not a unit of work.

**Feature branch.** A feature branch is the git branch on which one **feature** is built, named `feature/<slug>`. It holds the feature's code, its tests and the records written while it is open, and it merges into the main branch only on the owner's go-ahead. Only one branch at a time writes records, so at most one feature branch is open. The section "Branches" in `{{RULES_DOC}}` gives the rules.

**Gate.** A gate is a command that exits non-zero when a condition it checks is not met, so that a build or a close-out stops rather than carrying on. jtrek has three of them: `jtrek check`, `jtrek build --check` and `jtrek agent --check`. A **postponement** can make one of them report a failure and still exit 0.

**Hand-off.** The hand-off is the file `{{STORE}}/jtrek_handoff.md`, which describes where the project stands and how it came to stand that way, for the session that opens next. It is the project's own prose and nothing generates it. ⚠️ It is a different file from the procedure for closing a session, which is `{{HANDOFF_DOC}}` and which says how to bring the hand-off back to true.

**`in-progress`.** `in-progress` is the status meaning that a session ended with that record unfinished. It is never a resting state for work somebody is currently doing. A session that ends normally leaves no record at this status, so a query for it returns every record an earlier session left unfinished and nothing else. An interrupted session leaves one such record rather than several, because the procedure for stopping at the hard threshold forbids splitting the work or opening a second record.

**The loop.** The loop is the sequence of four steps that every change to the store goes through, in this order: `jtrek query` to look, `jtrek checkout` to take the work, editing `work.json`, then `jtrek checkin` to write the rows, and `jtrek build` to regenerate `registry.md`. The first rule of the store, R1, is that the loop is the only way to write.

**`next_free_id`.** `next_free_id` is a field in `work.json` holding the id that a newly created record should take. It applies only to an item that does not exist yet. A record that already exists has an id of its own and is retrieved with `jtrek checkout`. The id is the highest number in the store plus one, padded to six digits, so a new project starts at `R-000001`.

**Record id.** A record's id is `R-` followed by at least four digits, and it is never reused or renumbered. ⚠️ **Its width is not fixed**, since jtrek pads a new id to six digits while a store's earlier records may have four, and a store that outgrows six digits simply gets wider ids. Nothing caps how many records a store may hold. Two consequences follow. Ids must never be compared as text, because `R-000124` sorts before `R-0123` that way while being the later record. And an id must never be matched with a fixed digit count, because a pattern for four digits finds `R-1000` inside `R-100000`.

**`plan` value.** A record's `plan` value is the field in its **row** naming which section of `{{PLAN_DOC}}` that work belongs to, written as the slug beginning that section's heading, such as `plan-surface`. The plan document holds one section per value, saying what that body of work is for. Progress is never written in the plan; it is derived by querying the records that name the section.

**Planning task.** A planning task is a `task` record for a planning effort. Its prose file names `/jtrek-plan`, holds the agenda, and ends with a "Where it stands" section that every planning session appends to, naming the topics settled, the topics still open and the next question. The opening procedure offers it like any other task, and [`{{PLANNING_DOC}}`]({{PLANNING_DOC}}) is the procedure a session follows once it is chosen.

**Pointer.** The pointer is the block of text that `jtrek agent install` writes into `AGENTS.md` and `CLAUDE.md`. It states the four rules in one line each and links to `{{RULES_DOC}}` for the reasoning behind them. When the store's records still use jtrek's earlier name, the pointer also explains that name. It is kept short deliberately, because instruction files are loaded on every session and compete for room.

**Postponement.** A postponement is an entry in a **`check` block** naming a check that should report in full and still exit 0. Both `why` and `until` are required. `why` records the reason, and `until` names a record whose completion would restore the check, which the `references` group verifies exists. Without both, a postponement would be a check switched off permanently with nothing recording why. ⚠️ A postponed check still prints its result, so read what a command says rather than only what it returns.

**Prose file.** A record's prose file is `{{STORE}}/records/R-XXXX.md`, named in that record's `detail_ref`. It holds what a session reads after it has found the record, rather than what makes the record findable. `jtrek query` searches the **rows** and never opens the prose files, so anything a later session would look for belongs in the row's `note` instead, however long that makes the row. All of a record's revisions share the one file. It must open with what the problem is, and no row may be checked in without it. Nothing versions it, which is why it is appended to rather than rewritten.

**Record.** A record is one tracked item: a bug fixed, a change made, a decision reached, a new task, a requirement, or a question the owner owes an answer to. One item is one record. Which kind it is comes from the `type` field. Every record has a **row**, and every row written since 2026-09-18 names a **prose file**. Used as a verb, to record something is to write its row.

**`registry.md`.** `registry.md` is a generated table of every record's **current state**, produced by `jtrek build` and committed alongside the store. It is never edited by hand. `jtrek build --check` fails when the committed file no longer equals a fresh render.

**`registry.ndjson`.** `registry.ndjson` is the store's log of **rows**, holding one JSON object per line, appended to and never altered. Only `jtrek checkin` writes it. ⚠️ Reading it with `grep` gives wrong answers in both directions, because superseded revisions are counted as though they were current and JSON-escaped text is missed. `jtrek query` is how it is read.

**Requirement.** A requirement is a record of type `requirement`, holding in `statement` one testable statement of what the product must do. It is `planned` once the owner has agreed to it, and in force while `done` and not superseded. It reaches `done` only once a passing test verifies it, and [`{{CODING_DOC}}`]({{CODING_DOC}}) says how. A task names the ones it meets under `implements` in `related`.

**Revision (`rev`).** A revision is a new **row** carrying the same `id` as an existing record and a higher `rev` number. Adding one is the only way to change a record. The earlier rows stay exactly as they were, so nothing in the store is ever edited or deleted.

**Row.** A row is one line in `registry.ndjson`, holding a record's `id`, `type`, `status`, `title`, `note` and the other fields. Every record has one. A row is what `jtrek query` searches, so information that is not in a row cannot be found.

**Session.** A session is one run of an agent working on the project, lasting from when that agent starts until either the work finishes or the session reaches its hard threshold. The hard threshold is a limit the project sets, described in `{{SESSION_DOC}}`, at which a session stops whatever state its work is in. The store's procedures bracket a session rather than define it: `jtrek start` opens one and `jtrek handoff` closes one, but neither command creates the session nor decides when it ends. A session stopped by its hard threshold before the close-out runs leaves its unfinished record at **`in-progress`**, which is the only reason that status exists. An agent also loses everything it has not written down when its session ends, which is why a finding gets a **row** rather than a mention in conversation.

**Spec.** The spec, `{{SPEC_DOC}}`, says what the product does, one **feature** at a time. A person writes each feature's heading and a paragraph saying what it is for. `jtrek build` writes the plan section the feature belongs to and the statements of its requirements in force under its `### Requirements` heading, so nothing there is written by hand.

**`split_from`.** `split_from` is the field in a **row** naming the record this one was broken out of. Using it requires checking out the record it names, because a split changes that record too: a revision is added to the parent saying what was broken out.

**Store.** The store is the directory holding a project's tracked work. By default it is the `jtrek` directory in the project root, where `jtrek init` creates it. What makes a directory a store is `registry.ndjson`, and everything else in it derives from that file or supports its use. A command locates it by trying, in order: the path in the `JTREK_STORE` environment variable; the `store` key of a `jtrek.json` in the working directory or one of its parents; and a directory named `jtrek/` found the same way. Besides `registry.ndjson`, the store holds:
- the **prose files**, under `records/`;
- `registry.md`, the generated table, which is committed;
- `registry.db`, a browsable SQLite copy from `jtrek build` that nothing reads and git ignores;
- `work.json`, the current **checkout**, which git also ignores;
- the generated documents, under `docs/`;
- and the project's own **hand-off**, `jtrek_handoff.md`, plan, `jtrek_plan.md`, and **spec**, `jtrek_spec.md`.

**Stranger.** The stranger is the reader every **row** and **prose file** has to be legible to, meaning a session that was not part of the work, has no code open, and found the record by searching. Writing for that reader means full sentences that make sense without seeing the code changes the work made, or the conversation in which it was done, and it means defining the project's own terms where they first appear.

**`supersedes`.** `supersedes` is a field in a **row**. When one record replaces another, the replacing record's row holds the replaced record's id in this field. The replaced record takes a new revision with `outcome: superseded`, but that revision does not name its replacement. To find what replaced a record, search for the row whose `supersedes` field holds that record's id: `jtrek query --query "supersedes LIKE '%R-0142%'"`, with the replaced record's id in place of `R-0142`. Before a row can name a record in its `supersedes` field, the replaced record has to be checked out too, because the same check-in has to write the replaced record's new revision, and `jtrek checkin` refuses when that record is not in the checkout.

**`work.json`.** `{{STORE}}/work.json` is the file a **checkout** writes, and it is the only file in the loop that is edited by hand. It is gitignored deliberately, so it is never committed, and it is not deleted after a check-in because it is what a merge conflict in `registry.ndjson` is recovered from.
