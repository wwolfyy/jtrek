# Plan

> 🔑 **This file belongs to the project.** jtrek created it once and will not write to it again. Reinstalling leaves it alone, `jtrek agent --check` does not compare it against anything, and uninstalling leaves it behind. Nothing in it is generated, and the text below is a template to replace. The planning procedure, [`{{PLANNING_DOC}}`]({{PLANNING_DOC}}), interviews the owner and writes it.

## How this document works

It holds **what each section of the work is, why it exists, and what the approach is**. That is prose only a person can keep true.

🔑 **It does not hold progress.** Whether a section is untouched, in flight or finished is derived from the records that name it. Writing progress here as well produces two answers to one question, and they drift. A plan whose boxes are ticked by hand is how finished work ends up recorded as still open.

Every record carries a `plan` value naming the section it belongs to, and each section's heading begins with that value, so a record and its section find each other:

```bash
jtrek query --query "plan = 'first-section' AND status IN ('open','in-progress')"
```

The value is a slug, made of lowercase letters and digits joined by hyphens and followed in the heading by ` — ` and the section's title. It is chosen when the section is added and never changed afterwards, even if the title changes, because records name it. A section whose meaning changes is a new section with a new slug.

⚠️ **That query returns nothing both for a section with no records yet and for a section that is finished.** `jtrek plan progress` tells the two apart: it reports each section as empty, in progress, awaiting review or finished, with the counts of the records behind that state.

A decision that settled something about a section is linked by its record id with a one-line summary, rather than copied here. The record is the only copy of the decision.

## The project

**Goal.** <What the project is for, and what exists when it has succeeded.>

**Out of scope.** <What the project deliberately does not do.>

**Constraints.** <Limits set from outside the project, such as a platform, a deadline or a dependency.>

**Done when.** <How anyone would know that the whole project is finished.>

---

## first-section — <the section's title>

<What this section covers, and why it exists. This first paragraph is what `jtrek start` prints beside every record naming the section.>

**Approach.** <How the work gets done.>

**Ruled out.** <What was considered and not chosen, and why. No diff records this.>

**Done when.** <How anyone would know that this section's work is finished.>

**Decisions.**

- <`R-XXXX` — the decision, in one line.>

## next-section — <the next section's title>

<…>
