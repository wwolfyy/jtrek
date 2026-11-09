# Session limits — stopping, and picking the work back up

A session ends for one of two reasons: the work finished, or the session reached its hard threshold. **This document is about the second one.** Closing a finished session is [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}).

🔑 **`in-progress` means one thing — a session ended with this record unfinished.** It is an exception marker rather than a resting state that work sits in while somebody is doing it. A session that ends normally leaves none behind, and that is what makes the resume query at the bottom of this document trustworthy: every record it returns is work that was genuinely interrupted.

---

## Two thresholds, doing different jobs

A threshold is a limit the project sets on how much of the context window a session may use. A session stops at its threshold rather than running until the context is full, because a harness does not necessarily stop at that point: some summarise the conversation and carry on, but a summary keeps only part of what the session knew. Anything not yet written into the store can be lost there just as it is when a run ends, so a session stops deliberately before either happens.

**The soft threshold stops you taking on anything new.** Finish the record you are on, or check it in. Do not start another, and do not open a new line of investigation.

**The hard threshold fires whatever the state**, including halfway through something. That case is what the rest of this document is for.

{{THRESHOLDS}} After changing them, run `jtrek agent install`. In Claude Code, a hook it installs tells the session when it crosses each one.

The numbers belong to the project. Start high, write down at each stop how full the window was and whether the next session needed anything the store did not hold, and let a few sessions move them. A threshold chosen before there is anything to measure is guesswork wearing a number.

---

## When the hard threshold fires

Six steps, in this order. The first two record the work, the next three close the session briefly, and the last one stops it. The hard threshold is a limit the project set below the size of the context window, so the room for a short close remains after it.

**1. Append what is done to the record's prose file** — a dated section at the end of `{{STORE}}/records/R-XXXX.md` saying what is finished and what is not.

⚠️ **Append; never rewrite it.** Every revision of the record points at that one path, so replacing the file's contents changes what earlier revisions say without appending anything. That is editing the past through the back door, and the append-only log exists to make it impossible.

**2. Check the record in at `status: in-progress`, with a `note` saying where it stopped and what comes next.** The prose file carries what was done; the note carries the resume point.

⚠️ **A record cannot be stored as `in-progress` without a note.** Both `jtrek checkin` and the schema refuse it. If you find you have nothing to write there, nothing was interrupted and the status should be `open`.

**3. Rewrite two sections of the hand-off, [`{{HANDOFF_FILE}}`]({{HANDOFF_FILE}}), and leave the rest alone.** The next session is a fresh one, and only the hand-off tells it the environment. "Start here" names the `in-progress` record first. "Where things stand" states the branch, what is uncommitted or unpushed, and anything installed on the machine. Ask the owner first whether the session ends in a commit, because without one this section names the uncommitted work. The deletion pass and archiving wait for the next normal close, because they take judgement, and the threshold is where a session stops spending it.

**4. Run `jtrek build`, then `jtrek handoff` and the three gates** that [`{{HANDOFF_DOC}}`]({{HANDOFF_DOC}}) lists.

**5. Commit if the owner agreed and every gate passed.** Never push, because a push publishes and a commit does not.

**6. Stop.** Do not split the record, do not open a second one, do not invent a status.

🔑 **One record, one extra revision.** Stopping at the hard threshold is not new work and does not earn a new id. **Splitting is for substance** — for a remainder that genuinely stands on its own as a unit of work — and reaching the threshold is no evidence of that. ⚠️ Some work cannot be split at an arbitrary point at all: a half-applied refactor is worse than one never started, and that is exactly when a revision is the only honest record.

📌 **There is no separate label for "stopped at the hard threshold", and there must not be.** A second name for one lifecycle state means every query asking what is in flight has to name both values, and one that names only the first returns rows rather than nothing — wrong, and silently so. What such a label would have measured is already in the log: the store is append-only, so a record that passed through `in-progress` and later went `done` stays permanently identifiable as one that was interrupted. Counting them is a query over revisions.

---

## A stage of a review stops the same way

The review of a finished feature or plan section runs each of its stages in a session of its own, and each stage has a task record of its own, as [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) sets up. A stage that reaches the hard threshold therefore follows the six steps above for its own task, and the next session resumes it through `in-progress` like any other record. The owner's report and the owner's changes are the work of the review task itself, so a stop there follows the six steps for the review task.

Each stage saves its work as it goes, so that the prose file and the note can say exactly where it stopped. The refactoring review commits each refactoring separately. The cross-family review writes the reviewer's whole report into its task's prose file before it records any finding. The arbitration writes the verdicts of each batch of findings into their records before it starts the next batch.

---

## No session ends with a checkout open

🔑 **Both ways out of a session end in a check-in.** Finishing the work ends in one; stopping at the hard threshold ends in one, which is step 2 above. So `{{STORE}}/work.json` is stamped `checked_in` whenever a session ends, and the next one starts with nothing half-taken.

A checkout that turned out to need no changes still closes: run `jtrek checkin` and it stamps the file, reporting that the registry was not touched. **There is no state in which the right move is to leave a checkout open.**

📌 **A conversation the owner closes and later resumes, as Claude Code's `/resume` does, is still one session.** Its checkout stays open, and nothing is recorded when it closes.

`jtrek handoff` refuses to write a hand-off while one is open, and `jtrek checkout` refuses to overwrite one. Neither is a formality — an unstamped `work.json` holds edits that exist nowhere else, and it is gitignored, so replacing it loses them for good.

## Picking it back up

```bash
jtrek checkout --query "status = 'in-progress'"
```

Read the `note` for the resume point and the prose file for what was done, then **take that work first**. From there it is an ordinary record: it goes through the loop and ends `done`, and nothing about the rest of its life is special.

⚠️ **If that command is refused, the previous session ended badly** — it left a checkout open, which the section above says cannot happen. The refusal is the tool protecting work that was never recorded. 🛑 **Do not reach for `--force`; it discards exactly that work.** Read the `work.json` that is there, finish its check-in, and then resume.

**Read the sections those records name** in [`{{PLAN_DOC}}`]({{PLAN_DOC}}) before starting. The records say where the work stopped; the plan document says what the section was for.

---

## What this cannot do for you

⚠️ **Nothing enforces any of it.** An interruption that was never checked in leaves no trace anywhere — no gate can fail on a record that was never written, and no query can return one. The mechanism is entirely the discipline of stopping in time to run the six steps.

🔑 **A query recovers the state of the work, but never the reasoning behind it.** The state is in the store; the reasoning is not, because a diff records what changed and never what you decided against. The approach ruled out an hour ago exists only in a transcript the next session will not have. That is R4, and R4 rather than the query is what decides whether a restart is cheap.

---

## Checklist, when the hard threshold fires

- [ ] What is done is appended to the record's prose file, as a new dated section.
- [ ] The record is checked in at `in-progress`, with a note saying where it stopped and what comes next.
- [ ] Anything found along the way that nobody asked for has its own record (R4).
- [ ] One record was written rather than two; no status was invented.
- [ ] No checkout is left open — `work.json` carries a `checked_in` stamp.
- [ ] The hand-off's "Start here" names the `in-progress` record first, and its "Where things stand" states the environment.
- [ ] `jtrek build` was run, and `jtrek handoff` and the three gates pass.
- [ ] Committed if the owner agreed; **not** pushed.
