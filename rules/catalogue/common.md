# Common coding standards

> This document is part of jtrek's catalogue of coding standards. It holds the standards that apply whatever the language and whatever the kind of program. No agent reads the catalogue while it writes or reviews code. A project chooses from it once, with its owner, and every standard the project adopts is copied in full into the project's `coding-standards.md`, which is the only file the refactoring reviewer reads.

## How each standard is written

Each standard is a heading that begins with an identifier in backticks, followed by the standard's name. The identifier never changes when the name is reworded, because the table at the end of a project's `coding-standards.md` names each standard by its identifier.

The first paragraph under the heading states the rule in one sentence, with a clause giving the reason for it. That paragraph is the standard in short. Everything after it is the full text: the reason at length, the tests that tell a violation apart from a legitimate case, and, where the rule is hard to apply from its statement alone, an example in neutral pseudocode. The documents by language say how a standard applies in each language.

The reason is part of the standard. Two standards sometimes pull in opposite directions, and only their reasons let a reviewer weigh one against the other.

## Errors and failures

### `common/no-silent-errors` — An error is never swallowed silently

Code that catches an error either handles it or logs it and raises it again, because an error that disappears turns a failure into wrong output that appears far from its cause.

Handling an error means doing something that leaves the caller with what it expects. Retrying an operation that failed for a transient reason is handling. So is treating an expected condition as a result, when the function's contract says the condition is a valid outcome and the caller is told which outcome occurred. Logging the error and carrying on is not handling.

An error is caught as narrowly as possible, by the specific type the code expects. A catch-all that takes every kind of error is allowed only at a process boundary: the top of a command, a request handler or a worker loop. There the error is reported, and the command exits with a failure or the request fails. When an error is logged, the log keeps its stack trace, because the message alone rarely says where the failure began.

These are violations: an empty catch block, a catch block whose only action is to log, and a catch-all below a process boundary. Catching an error to raise a more specific one, with the original error attached, is not a violation.

### `common/no-hiding-fallback` — No fallback hides a failure

When an operation fails, code does not substitute a default value or an alternative path and carry on as if the operation had succeeded, because the caller and the user then act on a result that was never produced.

A fallback is the substitute value or path. The test is why the substitute is used. A documented default for something that was not given is not a fallback, because nothing failed: an optional setting that is absent takes its default. A substitute chosen because an operation failed is a fallback, and it is a violation unless a requirement asks for it. When a requirement does ask for it, the code reports the failure where the user will see it, and the caller can tell the substitute apart from a real result.

```text
# Incorrect: a failed lookup becomes a price of zero, and the total is silently wrong.
price = fetch_price(item) on failure 0
total = total + price

# Correct: the failure reaches the caller.
price = fetch_price(item)
total = total + price

# Not a fallback: nothing failed, and the setting was simply not given.
timeout = settings.get("timeout", default = 30 seconds)
```

### `common/no-impossible-cases` — No code handles a case that cannot occur

Code does not check for or handle a condition that its callers and the code before it make impossible, because such code has to be read and maintained, and it tells the next reader that the condition can occur.

Common forms are a null check on a value that was just constructed, a catch around code that cannot raise that error, a branch for a type the type system already excludes, and a second validation of input that was validated where it entered the program. The test is to name the path by which the case could occur. If no such path exists in the current code, the handling is deleted.

Sometimes a case is impossible only because of an invariant held far away, which a later change could break. An assertion that fails loudly is then allowed. It states the invariant to the reader and stops the program when the invariant breaks, whereas handling the case would let the program carry on.

This standard does not cover input from outside the program. That input can be anything, so validating it is required, as `common/validate-untrusted-input` says.

```text
# Incorrect: a list built this way is never null, so the branch can never run.
items = [parse(line) for line in lines]
if items is null:
    return []
```

## Design

### `common/separation-of-concerns` — A unit of code handles one concern

A function or a module handles one concern, which is one reason to change, because a unit that mixes concerns has to be read, tested and changed for each of them, and a change made for one concern can break another.

A concern is a responsibility that changes for reasons of its own, such as parsing input, applying a rule of the domain, reading or writing storage, or formatting output for a person. The test is to list the reasons the unit would have to change. If two of them come from different sources, such as a change to a file format and a change to a business rule, the unit mixes concerns, and its parts are separated so that each such change touches one place. Fowler calls this smell Divergent Change. Its opposite, Shotgun Surgery, is one change that has to be made in many units, and it shows that one concern has been spread across them.

This standard does not ask for units to be made smaller or more numerous. A unit that handles one concern in many lines meets it. Splitting such a unit into pieces that always change together breaks it, because the one concern is then spread out. A separation adds no interface that no current caller uses, as `common/no-speculative-generality` says. A command or a request handler at the top of a program may call the units of several concerns in order, because coordinating them is its own concern.

```text
# Incorrect: one function parses the file, applies the discount rule and formats the table.
function report(path):
    rows = [split(line, ",") for line in read(path)]
    for row in rows:
        if row.tier == "gold": row.total = row.total * 0.9
    print(join rows as a table)

# Correct: each concern is one function, and the command calls them in order.
function report(path):
    orders = parse_orders(read(path))
    priced = apply_discounts(orders)
    print(format_table(priced))
```

## Structure

### `common/no-speculative-generality` — No structure exists that no current caller uses and no requirement states

A parameter, option, hook, layer or interface exists only when a current caller uses it or a requirement states it, because unused structure is read and maintained as if it mattered, and it hides behind tests that pass.

This standard is about structure, and not about behaviour nobody asked for. It must not be confused with a deep module, which is an abstraction that hides a lot of detail behind a small interface and is worth keeping. Three tests tell the two apart.

- **The deletion test.** Imagine inlining the abstraction into each of its callers. If the callers would become more complex, because they would now handle detail the abstraction hid, then the abstraction is deep and stays. If the callers would become no more complex, the abstraction is speculative.
- **Every part of the interface has a current user.** Each parameter, option and method is used by at least one caller outside the tests. A parameter that every caller passes the same value for is a sign that it is speculative.
- **A seam with one implementation is hypothetical, and a seam with two is real.** An interface, a base class, a plugin registry or a factory that has one implementation is folded into that implementation. A stand-in that the tests use in place of a slow or external system counts as a second implementation, because the tests depend on the seam to run.

```text
# Incorrect: only JSON exists, and no caller passes a format.
function export(records, format = "json"):
    if format == "json":
        return to_json(records)
    raise UnsupportedFormat(format)

# Correct:
function export(records):
    return to_json(records)
```

### `common/no-duplicated-logic` — Logic is not duplicated

When the same logic appears a second time, it is extracted into one place that both uses call, because two copies must be changed together, and sooner or later one of them is forgotten.

Logic here means a decision or a computation, together with the knowledge it encodes, such as a format, a limit or the order of steps. It does not mean text that happens to look alike. The test is whether a change to one copy, made because a requirement changed, would have to be made to the other as well. If it would, the two are duplicates. Two pieces of code that look alike but would change for different reasons are not duplicates. Merging them would tie together two things that change independently.

### `common/no-feature-envy` — Code does not depend on another module's internal data

A function works with the data of its own module, and asks another module for results rather than reaching into that module's fields, because code that depends on another module's internals has to change whenever those internals change.

This is Fowler's smell Feature Envy, stated without reference to classes. The fix is to move the behaviour to the module that owns the data, or to have that module offer an operation that returns the result. How either is done depends on the language, and the documents by language say how.

```text
# Incorrect: the invoice computes a discount from the customer's internal fields.
discount = customer.orders_last_year * 0.01 if customer.tier == "gold" else 0

# Correct: the customer module owns the rule.
discount = customer.discount_rate()
```

### `common/no-refused-bequest` — An implementation of an interface does not leave most of it empty or throwing

A module that implements an interface, or that extends a base, implements most of what it takes on, because callers rely on the interface and fail when an implementation refuses part of it.

This is Fowler's smell Refused Bequest, stated without reference to inheritance. When an implementation leaves most of the interface empty or raises an error from it, the interface is narrowed, or split into smaller interfaces that each implementation can meet in full, or the module stops claiming the interface and uses the other module instead.

### `common/no-data-clumps` — Values that always travel together are one type

When the same group of values is passed together through several functions, or stored together in several places, the group becomes one named type, because the group means something that no single value carries, and every place that handles the values separately can get them out of step.

This is Fowler's smell Data Clumps. A start and an end that make up a range, or a host, a port and a user name that make up a connection, are typical groups. The test is whether removing one value from the group would leave the others meaningless.

```text
# Incorrect: the three values travel together through every call.
function connect(host, port, user)
function describe(host, port, user)

# Correct:
type Endpoint = { host, port, user }
function connect(endpoint)
function describe(endpoint)
```

### `common/no-primitive-obsession` — A value with rules of its own is a type, not a bare string or number

A value that has rules of its own, such as an identifier with a format, an amount of money with a currency, or a duration with a unit, is represented by a type that enforces those rules, rather than by a bare string or number, because every place that handles the bare value must otherwise repeat the rules, and some of them will not.

This is Fowler's smell Primitive Obsession. The test is whether code checks the value's format, range, unit or ordering in more than one place. If it does, those checks belong to a type.

## Names and comments

### `common/names-say-what` — A name says what the thing does or holds

A name states what a function does or what a variable holds, because a reader who has to open the definition to learn it reads every use more slowly and misreads some of them.

A generic name such as `data`, `info`, `manager`, `handle`, `process` or `util` says nothing unless its context makes it specific. A boolean reads as a statement that is true or false, such as `is_open` or `has_changes`. A quantity whose type does not carry its unit names the unit, as `timeout_ms` does. A function named for one thing that does two is either renamed or split. A name that a change has made false is renamed in the same change.

### `common/comments-explain-why` — A comment explains why, not what

A comment records why the code is the way it is, such as a constraint, an alternative that was rejected or a consequence that is not obvious, rather than restating what the code does, because the code already says what it does, and a restatement goes stale without anything noticing.

A comment that restates the code is deleted. If code needs a comment to say what it does, it is renamed or restructured until it does not. A comment on a public interface that states what a caller may rely on is allowed, because the caller should not have to read the body. A comment that has become false is corrected or deleted in the change that made it false.

## Security

### `common/validate-untrusted-input` — Untrusted input is validated before it reaches a path, a shell command, a query or a regular expression

Input from outside the program is checked or escaped before it is used to build a file path, a shell command, a database query or a regular expression, because each of those reads parts of its text as instructions, and unchecked input can make them do what the input's author wants.

Input is untrusted when it comes from outside the program: arguments, environment variables, files, network requests, other services and the output of a language model. Each use has its own safeguard.

- **A path** is resolved and then checked to lie inside the directory it is meant to stay in, so that `..`, an absolute path or a symbolic link cannot lead outside it.
- **A command** is run with its arguments passed as a list to the call that starts the process, and never assembled into a string that a shell parses. Where the program accepts it, `--` goes before arguments that could begin with a dash.
- **A query** takes values through parameters, and never through text joined into the query.
- **A regular expression** built from input escapes that input as literal text. A pattern supplied by the user is compiled only with a limit on its running time, because some patterns take exponential time on some inputs.

Input is validated once, where it enters the program. Validating it again further in is handling a case that cannot occur, which `common/no-impossible-cases` rules out.

```text
# Incorrect: a branch named "main; rm -rf ~" runs a second command.
run_shell("git log " + branch)

# Correct: the branch name is one argument, whatever it contains.
run_process(["git", "log", "--", branch])
```

### `common/no-secrets-in-code-or-logs` — No secret appears in code or in a log, and no personal data appears in a log

A credential, key, token or password is never written in source code, in a configuration file under version control, or in a log message, and personal data is never written in a log message, because anything written in those places reaches everyone who can read the repository or the logs, and cannot be taken back.

A secret is read at run time from the environment or from a secret store. A test uses a made-up value, never a real one. When code logs a request, a configuration or an error that may contain a secret, it removes the secret from what it logs.

Personal data is information that identifies a person or can be tied to one, such as a name, an email address, a postal address, a telephone number or an account number. Code that logs an event concerning a person refers to the person by an identifier that means nothing outside the system, and removes personal data from a request, a record or an error before logging it.

## Performance

### `common/batch-io` — No I/O runs inside a loop when a batched form exists

When a loop makes a round trip to a disk, a network or a database on each pass, and the interface offers a form that does the work for every item at once, the code uses that form, because the cost of the round trips grows with the number of items, while the batched form pays it once.

Typical cases are a database query issued once per item, a request to a service issued once per item when the service offers a bulk request, and a write per line to a file that is not buffered. The test is whether a batched form exists. If none does, the loop is correct as it stands. Replacing a loop over an array with a vectorised operation concerns computation rather than I/O, and the document for data and numerical work covers it.

## Tests

### `common/test-can-fail` — A test must be able to fail

A test verifies a requirement only if it would fail when the behaviour the requirement states is missing, because a passing test is read as evidence that its requirement holds, and a test that cannot fail is evidence of nothing.

Three kinds of test pass while checking nothing:

- **A tautological test** restates the implementation, for example by computing its expected value with the code under test or with that code's helpers. It agrees with the code whatever the code does.
- **A test that reads source code as text** asserts that a file contains some string instead of running the code. It passes while the string is present, even when the behaviour is broken.
- **A test that asserts on a mock** checks that a replaced dependency was called, instead of checking what the product did. It passes whether or not the real dependency would have produced the right result.

Such a test is rewritten so that it runs the code and asserts on what the product does at its boundary: what a command prints, the exit code it returns, the files it writes, or what a function returns. That rewrite strengthens the test, so the refactoring reviewer may make it. A test that cannot fail also stops anybody from looking further.
