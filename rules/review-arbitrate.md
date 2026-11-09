---
name: jtrek-review-arbitrate
description: Run the arbitration stage of the review of a finished feature or plan section, in a fresh session of its own — take the stage's task, check each cross-family finding against the code a batch at a time and give it a verdict, confirmed, uncertain or disputed, without removing any, add each verdict to the finding's record, and append what the stage did to the review task. Use when the owner starts this stage after the cross-family stage has recorded its findings.
argument-hint: "<feature slug> | section <plan slug>"
---
# Review stage — the arbitration of the findings

This procedure is the third of the four stages of the review that [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) sets up. Terms such as **feature** and **requirement** are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}). Run as the Claude Code skill, the invocation names what is reviewed: `$ARGUMENTS`.

The cross-family reviewer may run on a less capable model than the writer, because it has to come from another lab, so some of its findings may be wrong or unimportant. In this stage the session acts as the arbitrator. It checks each finding against the code and gives it one of three verdicts: confirmed, uncertain or disputed. The verdict advises the owner and settles nothing. The owner still reads every finding and decides which are fixed. The session may run on the best model available, and it may come from the writer's family.

---

## Before starting

- [ ] **This is a fresh session, and it did not write the code.** The owner started it for this stage, and its conversation holds nothing from before this procedure was invoked, apart from opening the session with [`{{OPENING_DOC}}`]({{OPENING_DOC}}). If it holds earlier work, stop and ask the owner to start a new session.
- [ ] **The stage's task is open, and the session takes it.** Find the arbitration task of this review with `jtrek query`, and take it with `jtrek checkout --id`, unless the opening procedure already took it. If there is none, the owner skipped the stage or the review was never set up, so stop and tell the owner. If it is `in-progress`, read its note and its prose file, which say which findings already have a verdict, and continue with the rest.
- [ ] **The cross-family review has finished.** The task the stage's task names under `depends_on` must be `done` or `abandoned`. If it is neither, stop and tell the owner which task comes first.
- [ ] **There are findings to arbitrate.** The section "Cross-family review" in the review task's prose file lists their ids. There are none when the cross-family task is `abandoned`, or when the review found nothing. In that case, close the stage's task at `done` with a note saying why there was nothing to arbitrate, and end the session as Step 3 describes.

---

## The arbitrator's limits

These limits exist because an arbitrator of the writer's family is the one most likely to dismiss exactly the findings that the writer's family cannot see.

- **No finding is removed.** The arbitrator only adds a verdict, and every finding stays recorded. Do not merge findings, and leave the reviewer's wording as it is.
- **A finding is disputed only with evidence that the owner can check**, such as a test that passes and shows the behaviour, the lines of code that contradict the claim, or the requirement the finding misread. A finding that the arbitrator doubts only by reasoning stays uncertain.
- **The arbitrator changes no code and no test.** Running a test is allowed. The only things it writes are the verdicts in Step 2 and the section in Step 3.

---

## Step 1 — Read what the reviewer read

Read the section "Cross-family review" in the review task's prose file, and the reviewer's whole report in the cross-family stage task's prose file. Then read the requirements, the parts of [`{{ARCHITECTURE_DOC}}`]({{ARCHITECTURE_DOC}}) that name the feature or the section, and the change, as Part B of [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) lists them.

---

## Step 2 — Give each finding its verdict, a batch at a time

Take the findings a few at a time, in the reviewer's order. For each batch:

- Add the batch's finding records to the checkout with `jtrek checkout --add --id`.
- Read the code and the tests each finding names, and the whole of each file where a line cannot be judged without its surroundings. Give each finding exactly one verdict. **Confirmed** means that the code shows what the finding says. **Disputed** means that evidence shows the finding is wrong. **Uncertain** means neither.
- Write the verdict into each finding's record. Its `note` states the verdict, and a dated section appended to its prose file gives the arbitrator's evidence beside the reviewer's claim. Do not change the reviewer's claim, and do not drop a finding the arbitrator disputes.
- Append to the stage task's "Where it stands" the ids that now have a verdict.

A finished batch is a point the stage can resume from, so a stop loses at most the batch in hand.

---

## Step 3 — Record what the stage did, and end the session

Append a dated section headed "Arbitration" to the review task's prose file. Name the model the arbitration ran on, and list each finding's id with its verdict. List the disputed findings as a group of their own, each with the reviewer's claim beside the arbitrator's evidence. The owner's report is written from this section. If the report has already been written, add the verdicts to it as well.

Then add a revision of the stage's task at `done`, whose `note` names the model and gives the number of findings with each verdict, and says that the section "Arbitration" was appended to the review task's prose file. Run `jtrek checkin` and `jtrek build`, and commit on the branch. Close the session with [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}), whose "Start here" names the review task, for the owner's report.
