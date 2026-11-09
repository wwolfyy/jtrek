---
name: jtrek-review-refactor
description: Run the refactoring stage of the review of a finished feature or plan section, in a fresh session of its own — take the stage's task, refactor the change against the coding standards with one commit per refactoring, run the tests and the gates with one second attempt, and append what the stage did to the review task. Use when the owner starts this stage after /jtrek-review has set the review up.
argument-hint: "<feature slug> | section <plan slug>"
---
# Review stage — the refactoring review

This procedure is the first of the four stages of the review that [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) sets up. Terms such as **feature** and **requirement** are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}). Run as the Claude Code skill, the invocation names what is reviewed: `$ARGUMENTS`.

The session reads the change and the project's coding standards, refactors the code to meet them, and commits each refactoring. The writing agent never reads the coding standards, so this stage is where the code is brought up to them. The session must not have seen the code being written, so that it reads the code as a stranger would.

---

## Before starting

- [ ] **This is a fresh session.** The owner started it for this stage, and its conversation holds nothing from before this procedure was invoked, apart from opening the session with [`{{OPENING_DOC}}`]({{OPENING_DOC}}): neither the writing of the code nor another stage. Nothing outside the session can verify this, so the session checks its own conversation. If the conversation holds earlier work, stop and ask the owner to start a new session.
- [ ] **The stage's task is open, and the session takes it.** Find the refactoring task of this review with `jtrek query`, and take it with `jtrek checkout --id`, unless the opening procedure already took it. Step 2 of [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) opened it. If there is none, the owner skipped the stage or the review was never set up, so stop and tell the owner. If it is `in-progress`, an earlier session stopped at the hard threshold, so read its note and its prose file and continue from where it stopped.
- [ ] **`{{STORE}}/coding-standards.md` exists.** If it does not, stop, change nothing, and tell the owner that it is missing.
- [ ] **The change is known**, as the review task's prose file states it.
- [ ] **The cross-family review has not run yet.** If its task is already `done`, its reviewer read the code before this refactoring, and the section that Step 4 writes says so.

---

## Step 1 — Refactor the change

Read the coding standards, the change, and the whole of each changed file where a line cannot be judged without its surroundings. Then:

- Refactor the changed code until it meets the coding standards. Run the whole test suite before starting and after each refactoring, and keep every test passing.
- Add no behaviour. A refactoring that changes what a user could observe is not a refactoring.
- Do not weaken a test. Do not delete or skip one, remove an assertion, replace a real dependency with a mock, or change an expected value. A test that checks nothing may be made to check something, which strengthens it.
- Commit each refactoring separately, with a message beginning "Refactoring review:" that says what was changed and which standard it meets. Each commit is a point the stage can resume from, so a stop loses at most the refactoring in hand.
- A defect found along the way that no refactoring can fix without changing behaviour gets a record of its own, as R4 in [`{{RULES_DOC}}`]({{RULES_DOC}}) requires, and is left unfixed here.
- Ask the owner only when there is a genuine question, such as a standard that cannot be met without changing behaviour.

---

## Step 2 — Run the tests and the gates

When the refactoring is finished, run the whole test suite and the gates again, because the refactored code is what the later stages and the owner read.

---

## Step 3 — One second attempt, then revert what still fails

The writer's code passed before the refactoring began, so a test or a gate that fails now was broken by a refactoring commit. Make one attempt to fix or revert the commits that caused the failure, and then run the tests and the gates again.

There is one second attempt and no more. If a test or a gate still fails after it, revert only the commits that fail, and keep the ones that pass. The reverted commits stay in the branch's history. The owner decides in [`{{REVIEW_REPORT_DOC}}`]({{REVIEW_REPORT_DOC}}) whether the revert stands, or whether the refactoring is redone as a change on the branch.

---

## Step 4 — Record what the stage did, and end the session

Append a dated section headed "Refactoring review" to the review task's prose file. List the commits the stage made, one line each. Name each commit that was reverted in Step 3, and the failure it caused. Add the questions the stage raised, if any, and say whether the cross-family review had already run. The owner's report is written from this section. If the report has already been written, add what this stage changed to it as well.

Then add a revision of the stage's task at `done`, whose `note` gives the number of commits and of reverts and says that the section "Refactoring review" was appended to the review task's prose file. Append to the task's "Where it stands". Run `jtrek checkin` and `jtrek build`, and commit on the branch. Close the session with [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}), whose "Start here" names the next stage's task.
