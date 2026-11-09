---
name: jtrek-review-report
description: Run the last stage of the review of a finished feature or plan section, in a fresh session of its own — take the review task, write the owner's report from the sections the earlier stages appended, opening with the merge danger and naming every stage that did not run, put it to the owner, and on the go-ahead close the review task and merge without squashing. Use when the owner starts this stage after the other stages of the review have finished or been skipped.
argument-hint: "<feature slug> | section <plan slug>"
---
# Review stage — the owner's report and the merge

This procedure is the last of the four stages of the review that [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) sets up. Terms such as **feature** and **requirement** are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}). Run as the Claude Code skill, the invocation names what is reviewed: `$ARGUMENTS`.

The session writes a report for the owner from what the earlier stages recorded, and the owner either asks for changes or gives the go-ahead, which is the merge. This stage always runs, whichever other stages the owner skipped. Its record is the review task itself, which the set-up opened and which this stage closes.

---

## Before starting

- [ ] **This is a fresh session.** The owner started it for this stage, and its conversation holds nothing from before this procedure was invoked, apart from opening the session with [`{{OPENING_DOC}}`]({{OPENING_DOC}}). If it holds earlier work, stop and ask the owner to start a new session.
- [ ] **The review task is open, and the session takes it.** Find it with `jtrek query`, and take it with `jtrek checkout --id`, unless the opening procedure already took it. If it is `in-progress`, an earlier session stopped while making the owner's changes, so read its note and its prose file and continue from where it stopped.
- [ ] **Every other stage has finished.** Each task the review task names under `depends_on` must be `done` or `abandoned`. If one is not, stop and tell the owner which stage comes first.

---

## Step 1 — Write the owner's report

Append the report to the review task's prose file, in this order. Write it from the sections the stages appended, rather than from memory.

**1. The merge danger**, as the section "The merge danger" of [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) describes it, naming each one-way door the change contains. Then name each stage that did not run, and say whether the owner skipped it or it failed to run, and why. The review task's prose file names the stages skipped at the set-up, and a stage task closed as `abandoned` names a stage skipped later. Name any feature that the cross-family reviewer was not shown.

**2. A short summary** of what the change does, written for a reader who has not seen the code.

**3. Pseudo code and diagrams** of the parts that changed. Diagrams are written in Mermaid, so that a reader can see them as text and a later diff shows how they changed.

**4. The commits**, with the writer's listed apart from the refactoring review's. The refactoring review's commit messages begin with "Refactoring review:", which is how the two are told apart. Name any refactoring commit that was reverted, and the failure it caused.

**5. The findings**, one line each with its record id and its verdict, and the questions the refactoring review raised. A finding has no verdict when the arbitration did not run. List the disputed findings as a group of their own, with the reviewer's claim beside the arbitrator's evidence for each. A disputed finding that touches a one-way door is always read closely, because a wrong dispute there would let a hard-to-reverse defect merge.

---

## Step 2 — The owner decides, then the branch merges

Put the report in front of the owner. A two-way door with a small blast radius may be read lightly, and a one-way door is always read closely.

- **On the owner's go-ahead**, add a revision of the review task at `done` whose `note` records the approval. Check in, run `jtrek build`, and commit on the branch. Then merge the branch into the main branch without squashing, so that each commit survives.
- **If the owner wants changes first**, make them on the branch through the normal loop, and run the tests and the gates. Then add to the report which findings were fixed, list the commits of the fixes apart from the others with their merge danger first, and put the report in front of the owner again. No stage runs again unless the owner asks for it, because the owner asked for the fixes and reads them in the report. The review task stays open until the owner approves.

Close the session with [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}).
