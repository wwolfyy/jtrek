---
name: jtrek-handoff
description: Close a session by bringing the hand-off back to true — check the records in first, regenerate every figure that rots, delete what no longer describes where things stand, and run the gates. Use when the owner runs /jtrek-handoff or says "close the session", "update the hand-off", or "write up where we got to".
---
# Hand-off — closing a session

Bring `{{HANDOFF_FILE}}` back to true at the end of a session.

🔑 **It is written for one reader: the agent opening the next session.** It describes where the project now stands and how it came to stand that way — nothing else. An instruction about how to maintain the hand-off is written for whoever closes a session, so it belongs in this procedure rather than in `{{HANDOFF_FILE}}` itself.

**One hand-off covers one store.** A jtrek command resolves the store from the directory it was run in, so work in a directory that resolves to a different store belongs in that store's hand-off rather than in this one.

⚠️ **This procedure does not decide what happened — the records do.** The hand-off restates what the store already holds, and adds the few facts a store cannot hold: which branch, what is unpushed, and what needs a person. If the work of the session is not in the registry yet, **you are not ready** — write the records first. See Step 1.

---

## The failure this exists to prevent

A hand-off that is appended to at the end of every session grows until it can no longer be read in one sitting, and a document the next session will not read whole cannot tell that session where things stand.

🔑 **So every figure in the hand-off is regenerated and every paragraph is reconsidered for deletion, rather than today's news being added at the bottom.** A session that ends with the hand-off shorter than it started is a good outcome rather than a suspicious one.

---

## Step 1 — Write the records first

```bash
jtrek handoff
```

`jtrek handoff` does the part of this procedure that can be done mechanically. It prints open work by type, the open questions, what is parked and why, branch state, the rows recorded since the hand-off was last committed, and whether `registry.md` is current. **It exits non-zero on two conditions**: an unfinished checkout, or a stale `registry.md`.

⚠️ **Those two are formalities, and a clean exit says nothing about whether this session's work reached the store.** The command reads the store and the repository; it cannot see what happened in the session. **If this session finished, decided, abandoned, or worked around something that adds to what the store already holds, stop and put it in before going on** — R4 in `rules.md` says where it goes. A rejected approach leaves no trace in a diff, so the store is the only place it can be found.

🔑 **Report that check rather than only making it.** Before going on, write this session's work out as a list, one line per item, naming the row that holds each: a record id, or `no row yet`. Include the items that are already recorded. Nothing in the store and nothing in the repository records whether this check was made, so the written list is the only evidence of it, and a session that writes nothing cannot be told apart from one that never looked. Every `no row yet` goes into the store through R1's loop before Step 2 begins.

📌 **The judgement, rather than the command, is what keeps an account of the session out of the hand-off.** That account is what the session finished, decided, abandoned or worked around. An account of how a session spent its time does not describe where things now stand, so Step 4 deletes it, and writing it in the hand-off puts the only copy in the place this procedure clears. A record is where it survives, and `jtrek query` finds it.

---

## Step 2 — Take every figure from the command rather than from the hand-off

**Do not trust a number already written in the hand-off — including one written earlier in the same session.** Every figure below comes from `jtrek handoff`, which recomputes all of them on every run:


| Figure in the hand-off           | Where it comes from                             |
| -------------------------------- | ----------------------------------------------- |
| Open work, and its by-type split | `jtrek handoff` → **Open work**                |
| What needs a person              | `jtrek handoff` → **Needs a person**           |
| What is parked, and why          | `jtrek handoff` → **Parked**                   |
| Branch, and how far ahead        | `jtrek handoff` → **Where things stand**       |


⚠️ **A commit count written into the hand-off is always one short**, because the commit that adds the line is not yet made. Write the command that produces it instead, for the next session to run.

---

## Step 3 — Rewrite the sections that changed, and only those

- **In flight** — the current workstream and its status. Substantive work changes that status, so this section changes whenever the session did any.
- **Start here** — the resume point, written as the table below. This is the section the agent in the next session considers when deciding what to act on, and the one most worth spending words on.
- **What needs a person** — regenerate it. `jtrek handoff` derives this from the store as `type = 'question' AND status = 'open'`, so copy what the command prints rather than maintaining a list. Anything you would have added by hand belongs in a `question` record instead.
- **Where things stand** — branch, unpushed work, gate results. If a feature branch is open, name it and the feature it builds, and say whether it is waiting for the owner's go-ahead to merge. First ask the owner whether the session ends in a commit. With one, this section says nothing about the working tree; without one, it names the uncommitted work as deliberate.
- **Where the deep detail lives** — pointers to other documents. Stable; rarely needs touching.

🔑 **When a chunk of work finishes, the record changes and the hand-off usually does not.** A closed record that was never named here needs no entry here. Only mention a closed record if the next session would otherwise wonder where it went — for instance, because the hand-off named it as blocking.

### "Start here" is a table, and the columns mean different things

```markdown
| Pick up  | What it is                            | Background |
| -------- | ------------------------------------- | ---------- |
| `R-0063` | make the parser reject an unknown flag | `R-0062`   |
| `R-0025`, `R-0026` | both edit the same function  | —        |
```

⚠️ **`jtrek start` reads the first cell of each row and nothing else.** The other columns and any prose below the table are never offered as work, which is what lets a row name background without that background being picked up.

- **Pick up** — candidate records to check out, and nothing else. Multiple ids belong here together only when they are genuinely one pass, such as two records editing the same function.
- **What it is** — a few words rather than a sentence. The record holds the detail.
- **Background** — records to read before starting, which are not themselves work: the decision that explains the change, the bug it came out of, a superseded row worth knowing about. Write `—` when there is none.

📌 **A caveat about a row goes in prose below the table rather than in a cell.** A markdown table pads every cell out to the width of the widest one, so a sentence written into a single cell stretches every other row of the table to match it. The parser also stops at the first cell of each row, so a record named in the prose below the table cannot be mistaken for work.

---

## Step 4 — The deletion pass

Read the hand-off top to bottom and ask of each paragraph: **does it describe where things now stand, or how they came to stand that way?** If not, delete it — 📌 **an accurate paragraph that describes neither still goes.** Things that usually describe neither:

- A blocker that is now resolved, once nothing points at it.
- A "we are about to do X" note where X has shipped.
- A narrative of what a session did, where a record holds it. History stays in the hand-off only while it explains the present state; the record is the durable copy either way, so link it rather than summarizing it.
- Warnings about a structure that no longer exists.
- ⚠️ **Any paragraph instructing whoever writes the hand-off** rather than telling whoever reads it something. An instruction on maintaining it belongs in this procedure; a command the opening procedure already tells the next session to run does not need repeating here either.

---

## Step 5 — Brevity, and when to archive

Keep the hand-off short enough that the next session reads it whole. No command measures its length, so a hand-off that has grown long calls for a stricter deletion pass. **Never keep a session's narrative in it to make it complete.**

If the hand-off genuinely needs cutting and starting over, archive it and cut a fresh one. ⚠️ **Archiving is a real change with its own record** rather than a step to take silently while closing an ordinary session.

---

## Step 6 — Gates, then stop

```bash
jtrek check --since "$(git merge-base HEAD @{upstream})"
jtrek build --check
jtrek agent --check
```

⚠️ **`--since` covers every commit the upstream lacks.** Plain `jtrek check` compares against `HEAD`, which misses a hand-edit already committed. A feature branch that has never been pushed has no upstream, so give `--since` its merge base with the main branch instead, as in `git merge-base HEAD main`. With no upstream on the main branch, run `jtrek check` alone.

Add your project's own gates — type-checking, tests, a build, and so on. jtrek reports on the store and says nothing about whether the project's artifacts work.

**Then put the work that names no feature before the owner.** A feature's work is reviewed when the feature is finished, by [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}). Work that names no feature, such as an edit to the instructions, a decision or a bug in a document, has no such review, so the owner reviews it here. Give the owner a short report on it: the merge danger first, as the section "The merge danger" of that procedure describes it, using its list of one-way doors, then a summary of what changed. If the owner wants changes, make them and run the gates again. While a feature branch is open, no such work is done on it, so the only work of this kind there is the rows that record findings about other work.

🔴 **If every gate passed, commit**, unless the owner declined in Step 3: one commit holding whatever is not yet committed and the hand-off, its message naming the records changed and what shipped. On a feature branch each record was committed when it was finished, so this commit usually holds the hand-off alone. A failing gate stops the close-out uncommitted. **Never push without a go-ahead**, because a push publishes and a commit does not.

---

## Checklist

- [ ] Everything this session finished, decided, abandoned or worked around is in the store — as a new record, as a revision of one, or in a record's prose — unless it adds nothing to what is already recorded.
- [ ] **Anything worked around counts too** — a defect routed past that was not finished, decided or abandoned still belongs in the store, and routing around one is likely to leave it unrecorded, because the workaround removes the friction that would have prompted the note.
- [ ] `jtrek handoff` exits 0.
- [ ] Every figure came from a command rather than from what the hand-off already said.
- [ ] Sections that did not change were left alone.
- [ ] A deletion pass happened, and something was actually deleted or it was confirmed nothing had aged out.
- [ ] The hand-off is short enough for the next session to read whole.
- [ ] The gates pass; `registry.md` rebuilt if records changed.
- [ ] The owner was shown the work that names no feature, with its merge danger first.
- [ ] Committed once the gates passed, unless the owner declined; **not** pushed.

