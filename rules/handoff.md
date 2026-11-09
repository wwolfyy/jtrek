# HANDOFF

> **Written for the agent opening the next session: where the project stands and how it came to stand that way.** Nothing else earns a place here. The procedure for maintaining this file is [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}), and instructions belong there rather than in this file.

---

## In flight

_The current workstream, and what unblocks it. Rewrite when the workstream changes; otherwise leave it alone. Name the records it turns on, and leave their statuses to the command below. No command reads this section, so a status written here is never checked against the store._

```bash
jtrek handoff        # open work, open questions, branch state, gates
```

## Start here

_What the next session should pick up. ⚠️ The first column is read by `jtrek start`, so it holds records to work on and nothing else; background goes in its own column, and a caveat about a row goes in prose under the table._

| Pick up | What it is | Background |
| ------- | ---------- | ---------- |
|         |            |            |

## What needs a person

**Regenerate this from the store.** `jtrek handoff` derives it as open `question` records, so anything that would be added here by hand belongs in a `question` record instead.

```bash
jtrek query --query "type = 'question' AND status = 'open'"
```

## Where things stand

_Branch, unpushed work, gate results. Every figure comes from a command rather than from this file._

- **Branch, and how far ahead** — `git rev-list --count <base>..HEAD`, `git status --short`
- **Open feature branch** — the feature it builds, and whether it is waiting for the owner's go-ahead to merge
- **Gates** — `jtrek build --check`, `jtrek agent --check`, plus this project's own

## Where the deep detail lives

_Pointers. Stable; rarely needs touching._

| Question | Where |
|---|---|
| What is left to do, and what is done | the store — `jtrek query`, `jtrek handoff` |
| Why a decision went the way it did | the record's `note`, and its prose in `{{STORE}}/records/` |
| What each part of the work is meant to achieve | [`{{PLAN_DOC}}`]({{PLAN_DOC}}) |
| How to use jtrek — the store, the CLI and the agent instructions | [`{{RULES_DOC}}`]({{RULES_DOC}}) |
