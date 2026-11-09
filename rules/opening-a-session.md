---
name: jtrek-start
description: Open a session by deciding what to work on from evidence — report the blockers, rank the candidates with the source each came from, and check nothing out until the owner has chosen. Use when the owner runs /jtrek-start or says "what should I work on", "pick up where we left off", or at the beginning of a session.
---
# Start — opening a session

This procedure decides what a session works on, using the store, the hand-off and the plan together rather than whichever of them the agent happened to read first.

Nothing in it writes. `jtrek start` and `jtrek query` both read and take nothing, and `jtrek checkout` runs only after the owner has chosen. That ordering is what lets an open checkout mean that a record was taken, rather than that somebody was browsing.

The procedure does not choose the work. It gathers what a choice needs and ends with a recommendation and the reason behind it, and the owner answers.

---

## The failure this exists to prevent

Three documents can each suggest what a session should work on, and they carry different types of information. The store holds the records and their statuses, so it says what exists and what is still open. The hand-off is written by a person or an agent at the end of a session, so it says what that person or agent planned to do next and what the environment looked like at the time. The plan says what each body of work is for. Store and hand-off are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}).

A session usually starts with the agent reading the hand-off. The hand-off however may not represent the best information in deciding which task to pick. It probably is skewed in favor of tasks that relate to whatever the closed session was about, and it carries a recency bias. Also, the hand-off can go stale. It is not generated deterministically from any source, and no gate compares it against anything. This is a deliberate choice rather than an omission: a gate that fired whenever somebody edited their own prose would train everyone to ignore it. What protects the hand-off instead is that somebody reads it, and assesses what is written there in a holistic manner, taking into account the plan for the entire project and the registry of work.

For that purpose, `jtrek start` (a CLI command) prints, among other sections: 1) every candidate together with the source it came from, and 2) any disagreement between sources, shown as a disagreement rather than settled by preferring one silently.

The source label is what makes the output something the owner can decide from. Without it, the owner either picks arbitrarily or asks where each one came from. Printing the source answers that before it is asked. Printing a disagreement puts it in front of the owner, because the sources are authoritative for different types of information as described below in Step 4.

---

## Step 1 — Gather the evidence

First find out whether a feature branch is open, meaning a branch not yet merged into the main branch:

```bash
git branch --no-merged main
```

If the project's main branch has another name, use that name instead of `main`. If a branch named `feature/<slug>` is listed, switch to it before going on. Only one branch at a time writes records, so the open branch holds the newest store and the newest hand-off, and the main branch holds older copies of both. The section "Branches" in [`{{RULES_DOC}}`]({{RULES_DOC}}) gives the rule.

```bash
jtrek start
```

`jtrek start` does the part of this procedure that can be done mechanically. It reads the three sources and prints, in order: how large each source is, the blockers, the open questions that need a person, a ranked shortlist of candidates with the source and the plan section behind each, any disagreement between the sources, and a recommendation.

The command always exits 0, which is deliberate. `jtrek handoff` is a gate, so it exits non-zero when the store is not fit to write a hand-off from. This one reports rather than gates, because a session resuming an interrupted record would otherwise open by reading a failure.

---

## Step 2 — Deal with the blockers, and do not treat them as choices

`jtrek start` reports three things before any candidate, and none of them is work to choose between. Each has to be dealt with, or explained away, before the shortlist is read.

**A record at `in-progress`** means a session ended with that record unfinished, which is the only thing that status means. It is never a resting state for work somebody is currently doing, and it never means the record is in hand. Resume it, or say why not. [`{{SESSION_DOC}}`]({{SESSION_DOC}}) says how a record gets there and how to pick it back up.

**An open checkout in `{{STORE}}/work.json`** means that the file holds edits which exist nowhere else, because nothing has copied them anywhere yet. It may belong to a conversation the owner closed in order to resume it, so ask the owner before finishing it by running `jtrek checkin`.

**A failing gate** means something the store keeps true has stopped being true. Either `registry.md` or the requirements listed in the spec no longer match the store, or the installed agent instructions no longer match the jtrek that generated them.

---

## Step 3 — Read the candidates with their evidence rather than as a menu

Each candidate is printed with the source that produced it. The ranking is fixed and the output states it, so a session that disagrees with the order has something specific to disagree with:

1. **Records the hand-off names under "Start here"**, in the order it gives them, because a person or an agent wrote that order at the end of a session that had the context.
2. **Every other open record, most recently revised first**, because the revision date is a fact the store holds rather than a judgement anybody made.

Open `question` records are listed separately and kept out of the shortlist. Each one is a decision the owner owes an answer to, so an agent cannot pick it up as work. Open `requirement` records are kept out too, because each is a proposal awaiting the owner's review rather than work. The dashboard of `jtrek view` counts them.

While a feature branch is open, only that feature's work can start, and every other candidate waits until the branch has merged. A candidate waits whether it implements requirements of a different feature or names no feature at all, unless it is a bug or a change in the code that the branch added. Say so beside each candidate that waits when offering it.

Read the plan section printed beside a candidate before choosing it. [`{{PLAN_DOC}}`]({{PLAN_DOC}}) says what that body of work is for, and work whose purpose has been overtaken is worth raising with the owner rather than doing.

---

## Step 4 — Take the disagreements seriously

Each source is authoritative for some types of information but not for others, and the table below shows which. A conflict between them is reported as a conflict rather than settled by preferring one source silently.


| Source                                 | Authoritative for                                         | Never for                   |
| -------------------------------------- | --------------------------------------------------------- | --------------------------- |
| the store                              | status, content, what exists                              | environment, intent         |
| [`{{HANDOFF_FILE}}`]({{HANDOFF_FILE}}) | environment state, and what the last session planned next | any record's status         |
| [`{{PLAN_DOC}}`]({{PLAN_DOC}})         | what a section is *for*                                   | progress, by its own design |


The case this table exists for is a hand-off naming a record the store has already closed. The store wins on status, so the record stays closed and the hand-off is out of date. Say so in the report, because the next session inherits that hand-off and would otherwise read it the same way.

---

## Step 5 — Put the choice to the owner, then take the work

Offer the shortlist, the recommendation with the reason behind it, and an explicit option to choose none of them. A session may legitimately open on something the store has never heard of.

Once the owner has chosen, find the feature the record belongs to, which is the feature of the requirements it implements. If it has one, switch to that feature's branch, or create the branch if this is the feature's first task, before taking the record. The section "Branches" in [`{{RULES_DOC}}`]({{RULES_DOC}}) says why the switch comes first. Then take it:

```bash
jtrek checkout --id R-0142        # or --new, for an item that does not exist yet
```

Do not run that before the owner has chosen. Everything up to this point wrote nothing, and the checkout is the moment the work is taken, so one opened during selection would record a decision nobody made. R1 and R3 in [`{{RULES_DOC}}`]({{RULES_DOC}}) are the rules behind this.

If the chosen record is a planning task, whose prose file names `/jtrek-plan`, the session continues with [`{{PLANNING_DOC}}`]({{PLANNING_DOC}}). If it is a stage of a review, or the review task itself, its prose file names the skill and the procedure that run it, such as `/jtrek-review-refactor`, and the session continues with that procedure. Its first check is that the session has done nothing yet apart from opening, as [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) explains.

---

## Checklist

- [ ] The session moved to the open feature branch, if there was one, before running `jtrek start`.
- [ ] `jtrek start` was run, and its figures were used rather than the hand-off's.
- [ ] Every blocker was reported before any candidate was offered.
- [ ] No `in-progress` record was passed over silently.
- [ ] Each candidate was offered with the source it came from.
- [ ] Any disagreement between the store, the hand-off and the plan was stated rather than resolved quietly.
- [ ] Selecting nothing was offered as a real option.
- [ ] Nothing was checked out until the owner chose.
- [ ] A record of a feature was checked out on that feature's branch.

