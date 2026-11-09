---
name: jtrek-review-cross
description: Run the cross-family stage of the review of a finished feature or plan section, in a fresh session of its own — take the stage's task, start an agent from another family of models with jtrek cross-review, record every finding it reports as a record of its own, and append what the stage did to the review task. Use when the owner starts this stage after the refactoring stage has finished or been skipped.
argument-hint: "<feature slug> | section <plan slug>"
---
# Review stage — the cross-family review

This procedure is the second of the four stages of the review that [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) sets up. Terms such as **feature** and **requirement** are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}). Run as the Claude Code skill, the invocation names what is reviewed: `$ARGUMENTS`. The command this stage runs is `jtrek cross-review`.

An agent from a different family of models from the writer's reads the refactored code against the requirements and the architecture document, and reports findings without changing anything. Models of one family tend to share blind spots, so a reviewer from the writer's own family is likely to miss what the writer missed. The session starts that agent and records what it reports.

---

## Before starting

- [ ] **This is a fresh session.** The owner started it for this stage, and its conversation holds nothing from before this procedure was invoked, apart from opening the session with [`{{OPENING_DOC}}`]({{OPENING_DOC}}). If it holds earlier work, stop and ask the owner to start a new session.
- [ ] **The stage's task is open, and the session takes it.** Find the cross-family task of this review with `jtrek query`, and take it with `jtrek checkout --id`, unless the opening procedure already took it. If there is none, the owner skipped the stage or the review was never set up, so stop and tell the owner. If it is `in-progress`, read its note and its prose file and continue from where it stopped.
- [ ] **The stage before this one has finished.** The task the stage's task names under `depends_on` must be `done` or `abandoned`. If it is not, stop and tell the owner which task comes first. When there is no such task, the owner skipped the refactoring review, so the reviewer reads code that was never refactored, and the section that Step 3 writes says so.

---

## Step 1 — Start the cross-family reviewer

Start a reviewer from a family of models other than the writer's, with the instruction to follow Part B of [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) for the feature or section named. Another lab's command-line coding agent, run without interaction and with read-only access, is such a reviewer. A reviewer from the writer's family does not count, whatever model it runs on.

Start it with `jtrek cross-review --feature <slug>`, or with `jtrek cross-review --section <slug>` for a plan section, and add `--base <branch>` when the work merges into a branch other than `main`. The command reads the `cross_review` block of `jtrek.json`, which names the agent to start (`claude`, `codex`, `gemini` or `agy`, the Antigravity CLI), the family of the models that write the project's code, the reviewer's family and, optionally, the model the reviewer runs on. It refuses a reviewer whose family is the writer's. It gives the agent Part B of [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) together with the requirements and the change, runs it read-only and without interaction, and prints the report the agent returns. The change it gives leaves out the store's `registry.ndjson`, `registry.md`, `records` directory, hand-off and `docs` directory, because they record the work or are generated, and the instruction tells the reviewer so. The instruction also explains how to read the store with `jtrek query` and `jtrek history`, lists the columns a query can name with their meanings from [`{{SCHEMA_DOC}}`]({{SCHEMA_DOC}}), and names the only commands the reviewer may run: `jtrek query`, `jtrek history`, `ls`, `cat` and `grep`. When Part B is run by hand, leave the same files out of the diff handed over, with `:(exclude)` pathspecs.

⚠️ **When the command refuses or fails, the cross-family review has not run.** That happens when `jtrek.json` has no `cross_review` block, or when the agent is not installed or exits with an error. Do not start a reviewer of the writer's family in its place. Write in the section of Step 3 that the cross-family review did not run and why, so that the owner's report says so at the top and the owner reads more closely. The owner may run Part B by hand in another lab's agent and hand back what it reports.

⚠️ **With the agent `agy`, the review produces a report only if `agy`'s settings allow the five commands the reviewer may run.** `jtrek cross-review` starts `agy` without a terminal, so `agy` cannot ask for permission, and it refuses every command its settings do not allow. A refused command ends the whole review with an empty response, and the command then fails with "The reviewer 'agy' returned an empty response". The rules are read from `permissions.allow` in `~/.gemini/antigravity-cli/settings.json`, which is not the settings file of Gemini CLI, and they must hold these five entries:

```json
{ "permissions": { "allow": ["command(ls)", "command(cat)", "command(grep)", "command(jtrek query)", "command(jtrek history)"] } }
```

`agy` has no option that passes settings for one run, so these rules apply to every use of `agy` on the machine. Do not add a rule for `git`. The commands `git diff`, `git log` and `git show` accept `--output=<file>` and write that file, so allowing `git` would let the reviewer write. Ask the owner before changing that file, because it belongs to the owner's machine rather than to the project.

⚠️ **When `jtrek cross-review --section` warns that the merge of a feature was not found, the review covered only part of the section.** The command finds a feature's merge only by the subject git writes for it by default, so it misses a merge made through a GitHub pull request, a merge whose subject was edited, and a feature that has not merged. It still starts the reviewer, and it names each such feature in the instruction. Write in the section of Step 3 which features the reviewer was not shown, so that the owner can review their files another way.

---

## Step 2 — Record every finding

First append the reviewer's whole report to the stage task's prose file, in a dated section. The report then survives a stop before every finding is recorded.

Then write each finding into the checkout as a `bug` or `change` record, as R4 in [`{{RULES_DOC}}`]({{RULES_DOC}}) requires, with the review task under `related_to` in its `related`. Every finding is recorded, including one the session believes is wrong. The record's prose file holds the reviewer's claim in the reviewer's own words, and the place in the code it names. The arbitration stage, in [`{{REVIEW_ARBITRATE_DOC}}`]({{REVIEW_ARBITRATE_DOC}}), adds a verdict to each of these records. The owner decides in [`{{REVIEW_REPORT_DOC}}`]({{REVIEW_REPORT_DOC}}) which findings must be fixed before the merge.

---

## Step 3 — Record what the stage did, and end the session

Append a dated section headed "Cross-family review" to the review task's prose file. Say whether the review ran, and if it did not, why. Name the agent and the model that reviewed, and list the id of each finding record. Name any feature the reviewer was not shown. The owner's report is written from this section. If the report has already been written, add what this stage found to it as well.

Then add a revision of the stage's task at `done`, whose `note` names the agent and the model, gives the number of findings, and says that the section "Cross-family review" was appended to the review task's prose file. Append to the task's "Where it stands". Run `jtrek checkin` and `jtrek build`, and commit on the branch. Close the session with [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}), whose "Start here" names the next stage's task.
