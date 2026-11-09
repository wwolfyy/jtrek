# Spec

> This file belongs to the project, except for the lists of requirements in it. jtrek created it once from a template, and `jtrek agent install` will not write to it again. Reinstalling leaves it alone, `jtrek agent --check` does not compare it, and uninstalling leaves it behind. `jtrek build` rewrites only the part of each feature under its `### Requirements` heading. The planning procedure, [`{{PLANNING_DOC}}`]({{PLANNING_DOC}}), writes the rest with the owner, and the text below is a template to replace.

## How this document works

It says what the product does, one feature at a time. Each feature has a heading, followed by a paragraph that a person writes to say what the feature is for.

The requirements are not written here. A requirement is a record in the store, holding one testable statement, and its `feature` value names the heading it belongs under. `jtrek build` lists the statement of every requirement in force under the feature's `### Requirements` heading, and rewrites that list whenever a requirement changes. Anything written by hand under that heading is therefore lost on the next build. Before the list, `jtrek build` names the plan section the feature belongs to, which it works out from the `plan` values of the feature's requirements that are neither abandoned nor superseded. A feature belongs to one plan section, and the `spec` group of `jtrek check` fails when its requirements name more than one. `jtrek build --check` fails when the part under the heading no longer equals the store.

A feature heading reads `## <slug> — <title>`. The slug is made of lowercase letters and digits joined by hyphens. It is chosen once and never changed afterwards, because requirements name it. These slugs are separate from the plan's, so a requirement names a feature here and a section of the plan in two different fields.

The `### Requirements` heading is the last part of a feature's section. A feature written without one gains it at the end of its section on the next build. `jtrek plan spec` prints this document with the requirements of an open checkout in place, before they are checked in.

## first-feature — <the feature's title>

<What this feature is for, and who relies on it. Only a person can write this paragraph.>

### Requirements

Plan section: none, because no requirement that is neither abandoned nor superseded names this feature.

_No requirement is in force._
