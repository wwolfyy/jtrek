## Tracking work — jtrek

**jtrek tracks a project's work in the project's own repository.** It has three parts: an append-only store of records held under version control, a command line tool that is the only thing which writes to that store, and a set of generated instructions, session procedures and skills that teach an agent to use both.

@{{RULES_DOC}}

**Work is tracked in [`{{STORE}}`]({{STORE}}) and the rules are in [`{{RULES_DOC}}`]({{RULES_DOC}}). Read that file before writing anything to the store.** The line above imports it for agents that support imports; if you cannot see its contents, open it.

The loop is `jtrek query` → `jtrek checkout` → edit `work.json` → `jtrek checkin` → `jtrek build`. Four rules govern how it is used, and no code checks any of them, so they hold only while the agent reading them obeys them:

- **R1** — jtrek writes the registry, and a person never does. ⚠️ **Never hand-edit `registry.ndjson`.** Fix a mistake by adding the next revision, rather than by editing the row that was wrong. To add an item while a checkout is already open, append it to `work.json`; you do not need to check in first. ⚠️ **A record that already EXISTS is never appended by hand** — check in the work in hand, then check that record out and write the new information into it.
- **R2** — do not check in until the work is finished, prose file included. `jtrek checkin` writes a new version of the row, and nothing versions the prose file.
- **R3** — read the store with `jtrek query`; never `grep` it. `jtrek query` reads and writes nothing; `jtrek checkout` takes the work.
- **R4** — what you find gets its own row, in the same check-out/check-in loop as the work. Information that is not in a row cannot be found by `jtrek query`. A finding you are not going to act on is still a row. ⚠️ **`jtrek query` the whole store before writing a new row** — the records you have checked out are only some of them, and a duplicate can only be superseded, never removed.

⚠️ **`work.json` is gitignored — never commit it, and do not delete it after a check-in.** ⚠️ **`registry.md` is generated** — run `jtrek build` and commit the result when a record changes.

Opening a session: run `jtrek start` and follow [`{{OPENING_DOC}}`]({{OPENING_DOC}}) — decide what to work on from evidence, and take nothing until the owner has chosen. Closing a session: run `jtrek handoff` and follow [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}). Stopping at the hard threshold: follow [`{{SESSION_DOC}}`]({{SESSION_DOC}}). ⚠️ **`in-progress` means a session ended with that record unfinished**, rather than a resting state for work in hand. What the work is for: [`{{PLAN_DOC}}`]({{PLAN_DOC}}), one section per `plan` value, progress derived from the records rather than written there. Writing or revising the plan: follow [`{{PLANNING_DOC}}`]({{PLANNING_DOC}}). Writing code: follow [`{{CODING_DOC}}`]({{CODING_DOC}}). A term that will not resolve: [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}) defines the terms these documents use, alphabetically, for looking up rather than reading through.
