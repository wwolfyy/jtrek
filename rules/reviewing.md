---
name: jtrek-review
description: Set up the review of a finished feature or plan section before it merges — establish what is reviewed, open a review task and a task for each stage the owner does not skip, and end the session, so that each stage then runs in a fresh session of its own. Use when the owner says a feature or a plan section is finished, or runs /jtrek-review with a feature's slug or "section" and a plan section's slug.
argument-hint: "<feature slug> | section <plan slug> [--skip refactor,cross,arbitrate]"
---
# Review — a finished feature or plan section, before it merges

This procedure sets up the review of a finished **feature**, or of a finished plan section, before it merges into the main branch. Terms such as **feature**, **feature branch** and **requirement** are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}). Run as the Claude Code skill, the invocation names what is reviewed and which stages are skipped: `$ARGUMENTS`.

The agent that writes code makes it work and does not read the coding standards. It writes a failing test and then the least code that passes it, and it cleans up only the code it wrote during the task, as [`{{CODING_DOC}}`]({{CODING_DOC}}) says. Making the code meet the project's coding standards is left to this review. The review has four stages, run in this order, and each stage has a procedure of its own:

1. **The refactoring review**, in [`{{REVIEW_REFACTOR_DOC}}`]({{REVIEW_REFACTOR_DOC}}). A session that has not seen the writing refactors the code to meet the coding standards and commits.
2. **The cross-family review**, in [`{{REVIEW_CROSS_DOC}}`]({{REVIEW_CROSS_DOC}}). An agent from a different family of models from the writer's reviews the refactored code against the requirements and the architecture document, and the session records each finding. Part B of this document is that agent's procedure.
3. **The arbitration**, in [`{{REVIEW_ARBITRATE_DOC}}`]({{REVIEW_ARBITRATE_DOC}}). A session that has not seen the writing checks each finding against the code and gives it a verdict, and it removes no finding.
4. **The owner's report**, in [`{{REVIEW_REPORT_DOC}}`]({{REVIEW_REPORT_DOC}}). A session writes a report that opens with the merge danger, and the owner's go-ahead is the merge.

**Each stage runs in a session of its own**, which the owner starts, and each has a task record of its own. There are two reasons for this. A new session has not seen the code being written, which gives the refactoring review and the arbitration the fresh view they need. And a stage that is a record of its own can stop at the hard threshold and resume in the next session, as [`{{SESSION_DOC}}`]({{SESSION_DOC}}) describes for any record. A session that the owner opens with [`{{OPENING_DOC}}`]({{OPENING_DOC}}) to choose the stage still counts as new, because opening a session reads the store and the hand-off and sees no code being written.

This procedure does what has to happen once, before any stage runs. It runs in a new session, which the owner starts once the owner has said that the work is finished and the session that wrote the code has closed. A session's context fills as it writes code, so the set-up and the stages after it each start with a context of their own. The procedure ends the session it runs in.

[`{{MAP_REVIEW_DOC}}`]({{MAP_REVIEW_DOC}}) draws the whole review on one page, from the set-up to the owner's report. Its flowchart shows where each step sits, and its table shows which principles each step holds. The writing that comes before the review, and the owner's review of work that names no feature, are drawn in [`{{MAP_WORK_DOC}}`]({{MAP_WORK_DOC}}) instead.

---

## Which stages run

Every stage runs unless the owner skips it. The owner skips a stage by naming it after `--skip` in the invocation, as in `/jtrek-review review --skip cross`, or by saying so in another agent. The names are `refactor`, `cross` and `arbitrate`, and several are separated by commas. Skipping the cross-family review also skips the arbitration, because the arbitration checks the cross-family reviewer's findings and there are then none. The owner's report always runs, because the owner's go-ahead is the merge.

A stage that is skipped, or that fails to run, leaves the code less reviewed than the owner may assume. The owner's report therefore names it at the top.

---

## Step 1 — Establish what is reviewed

The owner decides when a feature or a plan section is finished. Then:

- **For a feature**, work on its branch, `feature/<slug>`. The change is everything the branch added since it left the main branch, which `git diff main...HEAD` shows. If the project's main branch has another name, use that name instead of `main`. The requirements are the feature's, which `jtrek query --query "type = 'requirement' AND feature = '<slug>'"` lists.
- **For a plan section**, all of its features have merged already, so there is no single branch to diff. Create a branch named `review/<slug>` from the main branch. The change is the current state of every file that the section's feature branches changed. For each of the section's features, `git log --merges --first-parent --grep "feature/<slug>" main` finds the commit that merged it, and `git diff --name-only <commit>^1 <commit>` lists the files it changed. The requirements are those whose `plan` names the section. The section's purpose and its "done when" in [`{{PLAN_DOC}}`]({{PLAN_DOC}}) are read too.

Before going on, check two things:

- [ ] **The tests and the gates pass** on the branch. A review of code that does not yet work reviews the wrong thing.
- [ ] **`{{STORE}}/coding-standards.md` exists**, unless the refactoring review is skipped. The refactoring review has nothing to refactor against without it. If it is missing, stop and tell the owner that the file has to be written first.

If the tests or the gates fail, record each failure as a `bug` record with `jtrek checkout --new`, as R4 in [`{{RULES_DOC}}`]({{RULES_DOC}}) requires, and open no review task. Do not fix the failure in this session. The fix is the feature's own work, so it is made on the branch through [`{{CODING_DOC}}`]({{CODING_DOC}}), which fixes the code rather than the test, and the set-up runs again once the fix is in. Whichever check fails, tell the owner what failed and close the session with [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}).

---

## Step 2 — Open the review task and a task for each stage

Run `jtrek checkout --new` and write these records:

- **The review task**, a `task` titled "Review of feature `<slug>`" or "Review of plan section `<slug>`", at `open`. Its prose file opens with what is reviewed, the range of commits the change covers, and the stages the owner skipped. It also names `/jtrek-review-report` and [`{{REVIEW_REPORT_DOC}}`]({{REVIEW_REPORT_DOC}}), which run the report. Each stage appends a dated section of its own to this file, headed with the stage's name, and the owner's report goes there as well. The report stage closes this task when the owner gives the go-ahead.
- **One `task` for each stage that runs**, apart from the report, at `open`. They are titled "Refactoring review of feature `<slug>`", "Cross-family review of feature `<slug>`" and "Arbitration of the findings on feature `<slug>`", with "plan section" in place of "feature" where a section is reviewed. Each prose file names the skill and the procedure that run the stage, such as `/jtrek-review-refactor` and [`{{REVIEW_REFACTOR_DOC}}`]({{REVIEW_REFACTOR_DOC}}), says what the stage is for and which review it belongs to, and ends with a "Where it stands" section that the stage's session appends to.

Every one of them takes the section's slug as its `plan`. In `related`, each stage task names the review task under `related_to`, and names the stage task before it under `depends_on`. The review task names every stage task under `depends_on`, because the report is written from what the stages found. A stage the owner skipped gets no task, and the review task's prose file names it.

Then run `jtrek checkin` and `jtrek build`, and commit on the branch.

---

## Step 3 — End the session

Close the session with [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}). The hand-off's "Start here" names the stage tasks in the order they run, followed by the review task.

Tell the owner to start a new session for the first stage, rather than resuming this one. The owner either invokes the stage directly, or opens the session with [`{{OPENING_DOC}}`]({{OPENING_DOC}}) and chooses the stage's task, whose prose file names the procedure to follow. In Claude Code, the stages run as `/jtrek-review-refactor`, `/jtrek-review-cross`, `/jtrek-review-arbitrate` and `/jtrek-review-report`, each in a session of its own. A stage the owner decides to skip after this point has its task closed as `abandoned`, with a note saying that the owner skipped it. A stage the owner decides to run after it was skipped gets a task in the session that runs it.

---

## The merge danger

The owner's report opens with the merge danger, and so does the owner's review of work that names no feature, in Step 6 of [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}). Both use this section.

Say whether the change is a one-way door, meaning a change that is hard to reverse, or a two-way door, meaning one that can simply be reverted. Then say how large its blast radius is, meaning how much it can affect if it is wrong. Name each one-way door the change contains. These are one-way doors in every project:

- a change to anything an agent reads as an instruction, such as the documents under `{{STORE}}/docs/`, `AGENTS.md` or `CLAUDE.md`;
- a change to the plan, to a feature heading of the spec or to a requirement's `statement`;
- a test that verifies a requirement in force being deleted, skipped or weakened, including an assertion removed or a real dependency replaced by a mock;
- an expected value in an existing test changing;
- a change to shared test infrastructure, such as the test runner, shared helpers or fixtures.

A test change is a one-way door even though git can revert it, because the danger is that nobody notices it, so it is never reverted. The architecture document names a project's own one-way doors, such as a change to a file format the product stores.

---

## Part B — For the cross-family reviewer

This part is the whole of the cross-family reviewer's procedure. Write nothing: no edit, no commit and no record.

**Read:**

- [ ] **The requirements.** For a feature, read every requirement whose `feature` is the feature's slug, with `jtrek query --query "type = 'requirement' AND feature = '<slug>'"`. For a plan section, read every requirement whose `plan` is the section's slug, and the section's purpose and "done when" in [`{{PLAN_DOC}}`]({{PLAN_DOC}}).
- [ ] **The architecture document.** Read the parts of [`{{ARCHITECTURE_DOC}}`]({{ARCHITECTURE_DOC}}) that name the feature or the section. A part that says it is only designed describes no code yet, so code missing from it is not a defect.
- [ ] **The change**, as the instruction states it, after the refactoring review.

**Look for each of these.** A finding is a statement that something is wrong, rather than a preference.

- [ ] **The code does not do what a requirement states**, or does more than any requirement states. Behaviour that no requirement states was never agreed to.
- [ ] **A test cannot detect what it claims to.** Find the test cases that name each requirement. Three kinds of test pass while checking nothing: a test that only restates the implementation, a test that reads a source file as text instead of running the code, and a test that asserts on a mock instead of on what the product does.
- [ ] **The code departs from the architecture document**, or the document no longer describes the code.
- [ ] **The code has a defect**, such as a wrong branch, a missing case, an error swallowed, or a value that cannot be what the code assumes.
- [ ] **For a plan section**: the features do not fit together, or the section does not meet its purpose and its "done when".

**Report** each finding, most serious first. Say what is wrong and where, as a file and line, and name what it breaks: a requirement's id, a part of the architecture document, or the section's purpose. Say how sure the finding is when it rests on something the review could not check. If there is no finding, say so and list what was read. Do not invent a finding to show that the review was thorough.
