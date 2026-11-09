---
name: jtrek-code
description: Write code spec-driven and test-driven — agree the requirement first, write a test naming it and watch the test fail, write the code that passes it, and put the requirement in force only in the check-in that lands the passing test. Use when implementing a feature, fixing a bug or changing what the product does, before writing the code.
---
# Code — writing it from the spec, test first

This procedure says how code is written in a project whose work is tracked with jtrek. Terms such as **requirement**, **feature** and **spec** are defined in [`{{GLOSSARY_DOC}}`]({{GLOSSARY_DOC}}).

It combines two disciplines. **Spec-driven** means that a behaviour the product gains or changes is stated as a requirement, and agreed, before any code is written for it. **Test-driven** means that each requirement is verified by a test that was seen failing before the code that makes it pass was written. The store connects the two. A task names the requirements it implements, a requirement names the files of its tests, and each test names the requirement it verifies.

---

## The failures this exists to prevent

- **A test written after the code passes at once.** A test that has never failed has not shown that it can detect anything, so it may be testing the wrong thing, or nothing.
- **Behaviour that nobody stated cannot be reviewed.** The owner agrees to statements rather than to code, so code with no requirement behind it was never agreed to, and the spec then describes a different product from the one that exists.
- **A requirement in force with no test is a claim that nothing checks.** A requirement is in force only once a passing test verifies it, and the `tests` group of `jtrek check` fails when a requirement in force names no test that names it.

---

## Step 1 — Find the requirements the work touches

Read the task and the requirements named under `implements` in its `related`. Then read the feature's paragraph in [`{{SPEC_DOC}}`]({{SPEC_DOC}}) and every requirement of that feature, whatever its status:

```bash
jtrek query --query "type = 'requirement' AND feature = 'checkin'"
```

The work then falls into one of four cases:

- **It implements requirements the owner has already agreed**, which are `planned`. Go to step 3.
- **It adds or changes behaviour that no requirement states.** Go to step 2 and write the requirement first.
- **It contradicts a requirement in force.** Go to step 2 and revise that requirement, which needs the owner's agreement.
- **It changes no behaviour a user could observe**, such as a refactoring. It needs no requirement, and the existing tests must pass before and after it.

The feature of those requirements decides the branch the work is done on. The section "Branches" in [`{{RULES_DOC}}`]({{RULES_DOC}}) says how.

A bug is behaviour that contradicts a requirement in force, or behaviour that no requirement states and the owner does not want. In the first case, the failing test in step 3 reproduces the bug. In the second case, the requirement comes first.

---

## Step 2 — State the requirement, and get the owner's agreement

A requirement is a record of type `requirement`, and [`{{SCHEMA_DOC}}`]({{SCHEMA_DOC}}) lists its fields. Its `statement` must pass four tests:

- **It states one behaviour.** A statement joining several behaviours with "and" is several requirements, and each is written as its own record.
- **It can be observed from outside the code.** A tester who has never seen the code must be able to tell whether it holds. "Check-in refuses a row whose `detail_ref` is empty" passes this test, and "check-in handles bad rows gracefully" does not.
- **It states behaviour rather than implementation.** It names no function, library or table unless that name is part of the interface, as a command's name and flags are. The implementation changes more often than the behaviour does, and a statement tied to it goes stale.
- **Its important cases are covered.** The empty input, the refused input and the second attempt are where defects occur. Each case that the owner would be upset to see broken gets its own requirement or its own test.

Write it with status `open`, which means proposed, and show the owner its statement. Once the owner agrees, add a revision at `planned` whose `note` records the agreement. The owner's agreement is also needed to change a requirement's `statement`, to supersede a requirement and to drop one. A change to what a feature is for is planning work, and [`{{PLANNING_DOC}}`]({{PLANNING_DOC}}) covers it.

Write no code for a requirement the owner has not agreed to. Code written first would decide the behaviour before the owner has.

---

## Step 3 — Red: write a test that names the requirement, and watch it fail

- **Name the requirement in the test.** Begin the name of each test case with the requirement's id, as in `R-0142: check-in refuses a row with no prose file`. That id is the link from the test back to the requirement, and a reader of a failing test follows it to the statement the test verifies.
- **Before writing the body, name the change to the code that would make the test fail.** If no such change can be named, the test cannot fail, and it has to be redesigned around a behaviour that can be observed.
- **Derive the expected values by hand.** An expected value computed by the code under test, or by its helpers, agrees with that code whatever the code does.
- **Test the behaviour at the product's boundary**: what a command prints, the exit code it returns, and the files it writes. Do not assert that a source file contains some text, and do not assert on a mock. Replace a dependency with a mock only when the real one is slow or external, and keep real every side effect the test depends on.
- **Each test case is one scenario of the requirement.** A requirement usually needs several cases: the ordinary one, and the edge and error cases from step 2. No separate list of scenarios is kept, because the test cases are that list.

Run the test and watch it fail. It must fail rather than crash, and it must fail because the behaviour is missing, rather than because of a typing mistake or a broken fixture. **A test that passes at once is testing behaviour that already exists**, so re-read the requirement and the code before going on.

---

## Step 4 — Green, then clean up

- **Write the least code that makes the test pass.** Add no option, parameter or behaviour that no test asks for.
- **Run the whole suite, not only the new test.** Report every failure it shows by name, including a failure the session did not cause.
- **If the test still fails, fix the code rather than the test.** Change the test only when it is itself wrong, and say why.

Steps 3 and 4 together are one cycle, and each cycle covers one test. Repeat them for each test a requirement needs, and then for each requirement the task implements.

### Cleaning up the code written for the task

The least code that passes a test is often not yet good code. It may repeat what an earlier cycle wrote, or keep a name chosen before the shape of the code was clear. The writing agent therefore cleans up the code it has written, within the limits below.

- **When.** A cleanup may follow any cycle whose test passes. One cleanup must follow the last passing test of each requirement, before step 6 puts that requirement in force. Step 7 then verifies the code in the form in which it will be committed.
- **What it may touch.** It touches only the code and the tests written during this task, in any of its cycles. Code that existed before the task is left as it is. Restructuring that code is work of its own, the fourth case in step 1.
- **What it may change.** Any restructuring that keeps the behaviour is allowed, and which restructuring to make is the writing agent's judgement.
- **What it must not change.** It adds no behaviour, removes no assertion and changes no expected value in a test. Run the whole suite after it, and the suite must pass.
- **It does not read the coding standards.** Once a feature is finished, an agent that has not seen the writing refactors the code against the project's coding standards, as [`{{REVIEWING_DOC}}`]({{REVIEWING_DOC}}) says. The coding standards are kept out of this procedure so that the writing agent's context holds the code it is writing.

---

## Step 5 — When a test shows that a requirement is wrong

Writing a test sometimes shows that a requirement cannot hold as written, or that it contradicts another requirement. When that happens, stop writing code. Revise the requirement through the normal loop, with the owner's agreement, and let `jtrek build` render the revised statement into the spec. Then return to step 3.

Do not bend the test to fit the code. Do not narrow, postpone or quietly drop behaviour a requirement states in order to make the work fit. If the work needs more than the requirements state, tell the owner what it needs and ask.

---

## Behaviour that already exists

A requirement stated for behaviour the code already has cannot be seen failing first. For such a requirement, write the test and watch it pass. Then break the code on purpose, by reverting the lines that provide the behaviour or by changing a value in them, and watch the test fail. Then restore the code and watch the test pass again. Say in the requirement's prose file that it was verified this way.

This exception covers only behaviour that existed before the work began. A test written after the code for new behaviour is not test-driven, and it needs the owner's permission, which the task's prose file records.

---

## Step 6 — Put the requirement in force

A requirement goes to `done`, which means in force, in the check-in that lands its passing test, and not before. In that revision:

- `files` names the test file, and may also name the source files that provide the behaviour;
- the `note` says which test verifies it;
- the task names the requirement under `implements` in its `related`.

A requirement whose test does not pass by the end of the session stays `planned`. Nothing about a requirement is in force until a test verifies it.

---

## Step 7 — Verify before claiming anything

Claim nothing that a command run in this session has not shown. Before checking in:

- [ ] **Run the whole test suite afresh**, read its output, and count its failures. An earlier run is not evidence.
- [ ] **Read each requirement the task implements** and find the test case that names it. A requirement with no such test is not finished.
- [ ] **Make the mutation check.** Imagine each realistic mistake in the new code, such as a wrong branch, a missing validation or an empty return value. At least one test must fail for each of them.
- [ ] **Run the gates** that [`{{RULES_DOC}}`]({{RULES_DOC}}) lists. `jtrek check` includes the `tests` group.

On a feature branch, check the record in and commit it once all of these pass, as the section "Branches" in [`{{RULES_DOC}}`]({{RULES_DOC}}) says.

---

## Signs that the work has gone wrong

Each of these means that code was written before its test or its requirement. Delete that code and begin again from step 2 or step 3.

| The thought | Why it is wrong |
| ----------- | --------------- |
| The change is too simple to test. | Simple code also breaks, and the test takes little time to write. |
| The test can be written afterwards. | A test written afterwards passes at once, which proves nothing. |
| The behaviour was already tested by hand. | A test by hand leaves no record, and it cannot be run again when the code changes. |
| The code already written can be kept as a reference. | A test written with the code in view tests that code rather than the requirement. |
| The requirement can be written once the code works. | The behaviour would then be decided by the code rather than agreed by the owner. |
