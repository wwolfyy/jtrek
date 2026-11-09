# Coding standards

> This file belongs to the project. `jtrek agent install` created it from jtrek's base set and will not write to it again, and no gate compares it with anything. The project adds standards of its own, and may change or remove any standard here.

## How this file is used

Only the refactoring reviewer reads this file. That reviewer refactors a finished feature or plan section until it meets these standards, as [`{{REVIEW_REFACTOR_DOC}}`]({{REVIEW_REFACTOR_DOC}}) says, and names in each commit message the standard the refactoring meets. The agent that writes the code does not read this file, so that its context holds the code it is writing.

Each standard is a heading that names it, a statement of what the code must do, and the reason for it. Two standards sometimes pull in opposite directions, and only their reasons let a reviewer weigh one against the other, so the reason is part of the standard.

## Tests

### A test must be able to fail

A test verifies a requirement only if it would fail when the behaviour the requirement states is missing. Three kinds of test pass while checking nothing:

- **A tautological test** restates the implementation, for example by computing its expected value with the code under test or with that code's helpers. It agrees with the code whatever the code does.
- **A test that reads source code as text** asserts that a file contains some string instead of running the code. It passes while the string is present, even when the behaviour is broken.
- **A test that asserts on a mock** checks that a replaced dependency was called, instead of checking what the product did. It passes whether or not the real dependency would have produced the right result.

Rewrite such a test so that it runs the code and asserts on what the product does at its boundary: what a command prints, the exit code it returns, the files it writes, or what a function returns. That rewrite strengthens the test, so the refactoring reviewer may make it.

The reason is that a passing test is read as evidence that its requirement holds. A test that cannot fail is evidence of nothing, and it stops anybody from looking further.
