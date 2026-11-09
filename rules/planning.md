---
name: jtrek-plan
description: Write or revise the project's plan by interviewing the owner, and record what the interview settles through the normal checkout and check-in loop once the owner agrees. Use when the session's chosen task is a planning task, when the owner runs /jtrek-plan with --draft or --edit, or says "plan this", "write the plan", "revise the plan" or "grill me on this".
---
# Plan — writing the plan and recording what it settles

This procedure interviews the owner, writes the project's plan, [`{{PLAN_DOC}}`]({{PLAN_DOC}}), its spec, [`{{SPEC_DOC}}`]({{SPEC_DOC}}), and its architecture document, [`{{ARCHITECTURE_DOC}}`]({{ARCHITECTURE_DOC}}), and records what the interview settles. Terms such as **planning task** are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}).

A planning session is a normal working session. It opens with `jtrek start`, writes records through `jtrek checkout` and `jtrek checkin`, and closes with `jtrek handoff` and [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}). What this procedure adds is how to plan: the interview, where each answer goes, and the owner's agreement before each check-in.

---

## The planning task, and the modes

A planning effort is itself a `task` record, called the planning task. Its prose file names `/jtrek-plan`, holds the agenda, and ends with a "Where it stands" section that every planning session appends to. The opening procedure offers it like any other task, so planning across several sessions needs nothing of its own.

The owner names the mode when invoking the procedure. If none is named, ask.

- **`--draft`** interviews the owner and writes the plan's preamble and its sections, and the spec. It is for a project whose plan is still the starting template, and for a **brownfield** project whose plan lacks the shape described in the next part.
- **`--edit <scope>`** is bounded planning, where the scope names a section, a feature or a record. The table below says which steps each kind of change runs.

| Kind of change | Steps it runs |
| --- | --- |
| A new section is added. | All of Steps 1 to 5 run, and the interview covers the section's purpose, approach, ruled-out options and "done when". |
| A section's purpose changes. | All steps run. The changed section is a new section with a new slug, and its records move to it as Step 4 describes. |
| A new feature or a change of scope is planned. | All steps run. The interview covers only the scope named, and Step 2 finds every section and record the change makes untrue. |
| One record is revised or added inside a section's existing intent. | This procedure does not run, because the change is an ordinary revision in a development session. |

Exporting records to an outside tracker is not supported.

---

## What the plan holds, and where each answer goes

The plan explains what each body of work is for. It never holds progress, because progress is derived from the records naming each section. It holds:

- **A preamble for the whole project**, stating the goal, what is out of scope, the constraints, and what finishing the whole project means.
- **One section per body of work.** Its heading is `## <slug> — <title>`, where the slug is lowercase letters and digits joined by hyphens, chosen once and never changed. The first paragraph says what the section covers and why it exists, because `jtrek start` prints that line beside every record naming the section. The section then states the approach, what was ruled out and why, and "done when". A "done when" states the criterion by which anyone would know the work is finished, and never claims that the criterion is met.
- **Links rather than copies of decisions.** Where a `decision` record settled something, the plan gives one line and the record's id. The decision itself lives only in its record.

Keep the plan and the architecture document brief. Progress, the history of the work and the reasoning behind a decision belong in the records, so a section that holds them grows longer without saying more about what the work is for. No command measures a document's length, so this instruction is all that keeps them short.

The spec says what the product does, one feature at a time. Each feature has a heading `## <slug> — <title>`, in the same form as a plan section but with slugs of its own, and a hand-written paragraph saying what the feature is for. Under it, beneath a `### Requirements` heading, `jtrek build` writes from the store the plan section the feature belongs to and the statements of its requirements in force, so nothing under that heading is written by hand. There is no separate requirements document.

The architecture document says how the product is built: its components, their boundaries and how data flows, with Mermaid diagrams. Each part names the features and sections it covers, because a review of a finished feature or section compares the code with those parts. It cites `decision` records rather than copying them.

The interview produces answers, and each goes to one place. What decides the place is whether a later session will need to find the answer with `jtrek query`, as R4 in [`{{RULES_DOC}}`]({{RULES_DOC}}) asks.

- **A settled answer that later work depends on**, or that somebody might otherwise reopen, becomes a `decision` record. If alternatives existed, the record says which were rejected and why. If none existed, it says that none were considered. A decision about the whole project, such as the goal or a constraint, has no `plan` value, because the preamble has no slug, and the preamble names its id.
- **Any other settled answer** goes into the prose of the section it explains.
- **Anything undecided that can be stated precisely** becomes a `question` record. No task is written for undecided work until its question is answered.
- **An idea too vague to state as a question** is sharpened into one during the interview if possible. Otherwise it gets at most one sentence in its section's prose, and never a record.
- **A statement of what must be true of the product** becomes a `requirement` record, one testable statement per record, as [`{{SCHEMA_DOC}}`]({{SCHEMA_DOC}}) describes. Its `feature` names a spec heading and its `plan` a plan section. It is `planned` once the owner agrees, and `done`, which means in force, only once a passing test verifies it, as [`{{CODING_DOC}}`]({{CODING_DOC}}) describes.
- **A piece of work** becomes a `task` record. It is `open` if it can start now, and `planned` if its direction is settled but it cannot start yet. It states how anyone will verify that it is complete, and it names under `implements` in `related` every requirement it meets or changes.

---

## Step 1 — Take the planning task

- [ ] **Find the planning task** with `jtrek query`, or write one with the owner under `jtrek checkout --new`. It is normally already checked out, because the opening procedure ends by checking out the chosen task.
- [ ] **Resume from its latest "Where it stands"**, and trust it over any memory of an earlier conversation. An empty one means this is the first planning session.

---

## Step 2 — Read before asking

- [ ] Read the store with `jtrek query`, the plan, the architecture document, the hand-off and the code the planning concerns, before asking the first question. Finding facts is the agent's job, and the agent never asks the owner something it can look up. The decisions belong to the owner.
- [ ] **A question the owner has already ruled on is reported, not asked again.** Name the record that holds the ruling.
- [ ] With `--edit`, find every section and record the change could make untrue. Query the records naming each section affected, `jtrek query --query "plan = '<slug>'"`, and the records linked to those through `related`, `supersedes` and `split_from`.
- [ ] If the request covers several independent bodies of work, say so, and divide it into sections before asking detailed questions.

**On a brownfield project**, the store and any planning material the owner names are the background, and the code is read where an answer depends on it.

- [ ] **Ask the owner what planning material already exists**, such as a plan, a roadmap, design notes or an issue tracker, and what of it to carry over. Read what is named before the interview goes on.
- [ ] **If records already name plan sections, keep those slugs.** `jtrek check` fails every record naming a slug the plan no longer has.
- [ ] **Look for documentation of the codebase.** Read the path in the `codebase_docs` key of `jtrek.json` first, then `docs/codebase/`, `ARCHITECTURE.md`, `docs/architecture*` and the README, which is weak evidence. Never run a tool to write it.
- [ ] **The interview's first question reports what the search found**, unless the owner has already ruled on it. If documentation was found, name it, say when it was written and how many commits have landed since, and ask whether it can be trusted. If none was found, ask whether some exists elsewhere, whether to produce some first, or whether to continue without it. Write a location the owner names into `codebase_docs`.
- [ ] **Read documentation as claims**, and check against the code any claim an answer depends on.

---

## Step 3 — Interview the owner

- [ ] **Start from a set of topics**: the goal and the outcome, what is out of scope and the constraints, how the work divides into sections, each section's purpose, approach, ruled-out options and "done when", the features each section covers, the dependencies between sections, the risks and unknowns, and what goes first.
- [ ] **Ask only questions whose prerequisites are settled.** When an earlier answer changes, revisit the answers that depended on it.
- [ ] **Ask one question per message**, except where the brownfield part of the spec step below allows more. Say why it matters and which decision it unlocks, give a recommended answer, and offer choices where possible.
- [ ] **Keep confirmed decisions, proposed defaults and unresolved questions apart.** Silence is not acceptance.
- [ ] **Challenge vague answers.** Check each answer against terms already defined, describe a concrete case that forces precision, and compare the answer with what the code does. Push back when the owner agrees to many answers in a row without engaging with them.
- [ ] **Never answer a question on the owner's behalf.**

**The spec is written one feature at a time**, and each feature is finished before the next starts.

- [ ] **Ask what the feature is for.** The answer becomes its heading and paragraph in the spec.
- [ ] **Ask what must be true of it, one statement at a time.** Each agreed statement becomes a `requirement` record in `work.json`.
- [ ] **Show the owner the draft** with `jtrek plan spec`, which renders the spec with the requirements in `work.json` in place, and correct it before the next feature.

**On a brownfield project**, the code already shows what the product does, so the agent finds that out and the owner judges whether it is intended. Ask in this order.

- [ ] **Which features exist.** Draft the list from the code, the commands, the tests and the `done` records, and ask the owner to confirm the grouping and the names in one question.
- [ ] **Whether each behaviour is intended.** For one feature at a time, draft its statements, from test names and `done` decisions first, and check each against the code. Present them in one message, and take one answer naming only the exceptions. An intended behaviour becomes a requirement, which stays `planned` until a test naming its id is listed in its `files`. An accidental one becomes a `bug` record, and one the owner is unsure of becomes a `question` record. Neither becomes a requirement.
- [ ] **What should be true that the code does not do yet.** Ask this as on a greenfield project. Each gap becomes a `planned` requirement and a task naming it under `implements`, and the requirement stays `planned` until that task lands its passing test.

---

## Step 4 — Write as the interview goes

- [ ] **The plan** is edited in place, in [`{{PLAN_DOC}}`]({{PLAN_DOC}}). **The spec** is too, above each `### Requirements` heading and never below it.
- [ ] **A new record** is appended to `work.json` with its id from `next_free_id`, after a `jtrek query` for one that covers it.
- [ ] **A record that already exists** is added to the open checkout with `jtrek checkout --add --id R-0142`, never by hand, and then edited there.
- [ ] **With `--edit`, draft each change in the conversation first**, list every section and record it makes untrue, and write it only after the owner confirms.
- [ ] **Each hazard the codebase documentation lists** becomes a record, after the search for one that covers it.
- [ ] **The architecture document** is written once the features are settled, each part after the owner agrees. On a brownfield project, draft it from the code.
- [ ] **A record moves to another section** by a revision that changes its `plan` value. No command moves records, so say how many will move before moving many. A `deferred` record takes no revision except one that changes its status, so it cannot move: the new section's prose names it, and it moves when it is taken up again.

**When the agent must ask the owner first.** The agent may reword prose, and may add a record inside a section's existing intent, without asking. It must ask before changing what a section is for, before superseding, closing or abandoning a record, and before adding or removing a section.

---

## Step 5 — Check in with the owner's agreement, and close

- [ ] **Before each check-in, show the owner what it will write**: each record's id, status and title, and the change to the plan, the spec and the architecture document. Wait for a separate yes, because an answer given during the interview is not consent to write. Then run `jtrek checkin` and `jtrek build`.
- [ ] **Stop when no question with settled prerequisites remains**, or when the owner stops the interview. Summarise what was settled, which questions remain open, and which tasks were written.
- [ ] **Append to the planning task's "Where it stands"**: the topics settled with the ids of the records holding them, the topics still open, and the next question. The task stays `open` with a `note` saying where it stopped, or is `done` when the planning is finished.
- [ ] **Close with `jtrek handoff`** and [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}), whose sweep catches what the interview discussed and nothing recorded.
- [ ] **Never start implementing.** Planning ends with records, a plan, a spec and an architecture document.

---

## Checklist

- [ ] Nothing was asked that the store, the plan or the code already answered.
- [ ] Each question waited for its prerequisites, and came one per message with a recommended answer.
- [ ] Every section has a first paragraph saying what it covers and why, an approach, what was ruled out, and a "done when" that claims nothing is met.
- [ ] The plan holds no progress, and links to decisions rather than copying them.
- [ ] On a brownfield project, the owner was asked what planning material exists, and every slug a record names is still a heading.
- [ ] Every feature in the spec has a paragraph saying what it is for, and its requirements are records rather than text under `### Requirements`.
- [ ] On a brownfield project, every behaviour the owner did not confirm as intended is a `bug` or `question` record rather than a requirement.
- [ ] Everything undecided is a `question` record, and no task depends on an unanswered one.
- [ ] Every task states how it will be verified, and names the requirements it meets or changes.
- [ ] Nothing was checked in without a separate yes, and the planning task's "Where it stands" was appended to.
