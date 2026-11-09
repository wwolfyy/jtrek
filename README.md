# jtrek

jtrek tracks a project's work inside the project's own git repository. It is built for projects in which an AI coding agent, such as Claude Code, does much of the work, and a person, called the owner here, decides what the agent works on.

jtrek has three parts:

- **A store of records.** Each bug, change, task, decision, question and requirement is one record. The records live in a directory of the repository, usually `jtrek/`, and are committed with the code. The store is append-only: a record is changed by adding a new revision of it, and earlier revisions are never edited or deleted.
- **A command line tool, `jtrek`.** It is the only thing that writes to the store, and it checks every write. It also reads the store, serves it as a web page, and runs a set of checks, called gates, that fail when the store has been damaged or has drifted from its generated files.
- **Generated instructions for the agent.** `jtrek agent install` writes the rules, the session procedures and, for Claude Code, a set of slash commands and a hook into the project. These teach the agent to use the store and stop it from editing the store by hand.

The rest of this file covers installing jtrek, setting up a project, what a working session looks like from the owner's side, reading the store, running the gates in CI, and moving to a newer release.

## Requirements

- **Node.js 24 or later.** jtrek uses only Node's built-in modules and has no dependencies, so nothing is compiled during installation.
- **git.** The store is meant to live in a git repository, and several checks compare it against git's history.
## Installing jtrek

A release of jtrek is a git tag in the public repository [`wwolfyy/jtrek`](https://github.com/wwolfyy/jtrek), such as `v0.2.0`. A release is installed globally with npm, directly from its tag. The installed copy is fixed: it does not change until a different tag is installed. `git ls-remote --tags https://github.com/wwolfyy/jtrek` lists the tags.

To install from GitHub, run:

```bash
npm i -g "github:wwolfyy/jtrek#v0.2.0"
```

To install from a local clone of that repository, run:

```bash
npm i -g "git+file:///path/to/jtrek#v0.2.0"
```

The text after `#` is the tag's name, including its leading `v`. To confirm the installation, run `jtrek --version`, which prints the version without the `v`, for example `0.2.0`.

The npm package is named `jtrek`, but it is not published on the npm registry, where the name `jtrek` belongs to an unrelated package. Install jtrek from a tag, as shown above.

jtrek was called jtrack before it was renamed. ⚠️ **Never run `npm i -g jtrack` or `npx jtrack`.** The name `jtrack` on the npm registry belongs to an unrelated package, so either command would fetch a different tool.

jtrek has to be on the shell's `PATH`, which the global install arranges. The Claude Code hook that protects the store runs the bare command `jtrek`. If the command is missing, the hook cannot run, and Claude Code then allows every edit without saying so. `jtrek agent install` warns when this is the case, and `jtrek agent --check` fails.

## Setting up a project

Run these commands at the root of the project's git repository.

1. **Create the store.**

   ```bash
   jtrek init
   ```

   This creates the store in `jtrek/` and writes `jtrek.json` at the root, which names the store so that every later command finds the same one. To put the store somewhere else, run `jtrek init --store <dir>`. If the project already holds a store, `jtrek init` adopts it and writes nothing into it.

2. **Install the agent instructions.**

   ```bash
   jtrek agent install --claude
   ```

   This writes a short pointer to the rules into `AGENTS.md`, into `CLAUDE.md`, or into both, depending on which exist, and creates `AGENTS.md` when neither does. The pointer is how the agent learns, at the start of every session, that jtrek tracks the project's work and where the rules are. Claude Code reads `AGENTS.md` as well as `CLAUDE.md`, so either file serves it.

   Without `--claude`, this writes only the pointer and the documents under `jtrek/docs/`. With `--claude`, it also writes the Claude Code slash commands, the hook that refuses hand edits to the store, and a rule file that tells Claude Code to edit files with the tools the hook can see. The choice is recorded in `jtrek.json`, so a later `jtrek agent install` with no flags repeats it. `--no-hook` leaves the hook out.

3. **Commit what was written.**

   ```bash
   git add -A && git commit -m "Adopt jtrek"
   ```

### What the setup writes

- `jtrek.json` names the store and records the agent integration.
- `jtrek/registry.ndjson` holds the records, one revision per line. Only jtrek writes to it.
- `jtrek/records/` holds one prose file per record, which explains the record at length.
- `jtrek/jtrek_plan.md` is the plan, which says what each body of work is for. It starts as a template.
- `jtrek/jtrek_spec.md` is the spec, which lists the product's features and their requirements. It starts as a template.
- `jtrek/coding-standards.md` holds the coding standards that the review of a finished feature refactors the code against. It starts as jtrek's base set, and the project adds its own standards to it.
- `jtrek/jtrek_handoff.md` is the hand-off, which the agent rewrites at the end of each session so that the next session knows where things stand.
- `jtrek/docs/` holds the rules and procedures the agent follows. They are generated, so they are replaced by the next `jtrek agent install` and should not be edited.
- `jtrek/.gitignore` keeps two files out of git. `work.json` holds the agent's work in progress, and `registry.db` is a database rebuilt from the registry.
- `.claude/skills/`, `.claude/settings.json` and `.claude/rules/jtrek.md` are written only with `--claude`. They hold the slash commands, the hook and the rule file.

`jtrek/registry.md`, a readable summary of every record, does not exist yet. `jtrek build` writes it, and the agent runs `jtrek build` after each check-in.

### Optional settings

- **Session thresholds.** A long session loses track of earlier context. Two limits, in tokens of context in use, can be set in `jtrek.json` as `"thresholds": {"soft": 250000, "hard": 300000}`. After the next `jtrek agent install`, a hook tells the agent when a session crosses either limit, and the session procedures say what to do at each. With no thresholds set, the agent is told that none is set.

## A working session, from the owner's side

In a project set up with `--claude`, a session is driven by five slash commands in Claude Code. Each one loads a procedure that the agent then follows.

1. **`/jtrek-start`** opens a session. The agent runs `jtrek start`, reports anything that blocks work, such as a record a previous session left unfinished, and lists the candidate records with the source each came from. It recommends one and waits. The owner chooses a record, or names new work, or chooses none.
2. **The work.** The agent checks the chosen record out, does the work, and writes what it found into the store. Each finding worth keeping becomes a record of its own, including a defect it noticed and did not fix, or an approach it tried and rejected.
   - **`/jtrek-plan`** is for planning: writing or revising the plan or the spec. The agent interviews the owner and records what the owner agrees to.
   - **`/jtrek-code`** is for writing code. The agent states each behaviour as a requirement, asks the owner to agree to it, writes a test that fails, then writes the code that makes the test pass.
   - **`/jtrek-review`** sets up the review of a finished feature or plan section, before it merges. It opens a task for the review and one for each of its stages, and ends the session. Each stage then runs as a skill of its own, in a new session the owner starts, and the owner may skip any of the first three with `--skip`. In **`/jtrek-review-refactor`**, a session that has not seen the writing refactors the code against the project's coding standards and commits. In **`/jtrek-review-cross`**, an agent from another family of models reviews the result against the requirements and the architecture document. In **`/jtrek-review-arbitrate`**, a session that has not seen the writing checks each of that reviewer's findings against the code and gives it a verdict, without removing any. In **`/jtrek-review-report`**, the owner reads a report that opens with how hard the change would be to reverse and names every stage that did not run, and the owner's go-ahead is the merge.
3. **`/jtrek-handoff`** closes a session. The agent checks in its records, rewrites the hand-off to say where things stand, and runs the gates. Before committing, it shows the owner the work that belongs to no feature, because no feature review covers that work.

The owner's part is to choose the work, to answer the questions the agent records for the owner, and to agree to or reject the requirements the agent proposes. `jtrek start` lists the open questions, and the dashboard of `jtrek view` shows both the open questions and the proposed requirements.

An agent other than Claude Code can use the same store. It reads the pointer in `AGENTS.md` and the documents under `jtrek/docs/`, and runs the same commands. It gets no slash commands and no hook.

## Reading the store

- **`jtrek view`** serves the store as a web page at `http://127.0.0.1:7391`, until it is stopped with Ctrl-C. The Records tab searches and filters every record and shows each one with all its revisions and its prose file. The Dashboard tab shows the store as a whole: each plan section's progress, the requirements of each feature, the open work, the open questions and the counts of records by type and status. `--port` chooses another port. The page reads the store again on every request and writes nothing.
- **`jtrek query --query "<condition>"`** prints the current revision of every record matching an SQL condition, as JSON. For example, `jtrek query --query "status = 'open'"` lists the open records. It writes nothing.
- **`jtrek history --id R-000001`** prints every revision of one record.
- **`jtrek/registry.md`** is a generated summary that can be read in any Markdown viewer.

Do not search `registry.ndjson` with `grep`. It holds every revision of every record, so a search counts revisions that are no longer current, and it misses text that JSON escaping has changed.

## The gates, and running them in CI

Three commands check that the store is sound. Each exits with a non-zero code on failure, never prompts, and can run in CI.

```bash
jtrek check            # the registry was only ever appended to, and every reference resolves
jtrek build --check    # registry.md and the spec's requirements match the store
jtrek agent --check    # the generated instructions match the installed jtrek
```

`jtrek check` compares the registry against the last commit. To check a whole branch in CI, run `jtrek check --since origin/main`, naming the branch the work will merge into. The job's clone then needs enough git history to reach that branch, which a shallow clone may not have.

A CI job needs Node 24 or later and jtrek installed from a tag, as described under "Installing jtrek". jtrek ships no CI workflow of its own.

## Moving a project to a newer release

A project that adopted jtrek under its earlier name, jtrack, follows [`MIGRATING.md`](MIGRATING.md) instead.

1. **Install the newer tag** with the same command as before, naming the new tag, for example `npm i -g "github:wwolfyy/jtrek#v0.3.0"`.
2. **Migrate the store if the new release asks for it.** A release that changes the store's format cannot read a store written in the older format. jtrek's commands then stop with a message saying which format the store is at and telling the reader to run `jtrek migrate`. Commit or discard any uncommitted changes to the registry first, because `jtrek migrate` refuses to run while they exist. It rebuilds the store, checks the rebuilt store before writing anything, and then replaces the registry. Commit the result.
3. **Reinstall the agent instructions** with `jtrek agent install`. The generated documents come from the release that writes them, so after an upgrade `jtrek agent --check` fails until they are rewritten.
4. **Regenerate the store's views** with `jtrek build`. A release can change what `jtrek build` writes into `registry.md` and the spec, so after such an upgrade `jtrek build --check` fails until they are rewritten.
5. **Run the three gates**, and commit what changed.

To find out which release a machine has, run `jtrek --version`. To see which releases exist, list the repository's tags, for example with `git ls-remote --tags` followed by the repository's address.

## Removing jtrek from a project

`jtrek agent uninstall` removes everything `jtrek agent install` wrote, which covers the pointer, the generated documents, the slash commands, the hook and the rule file. `--dry-run` lists what would be removed without removing it. It leaves the store, the plan, the spec, the hand-off and the coding standards alone, so the records stay in the repository.

## All commands

`jtrek --help` lists every command, and `jtrek <command> --help` describes one. The commands a person runs most often are these:

- `jtrek init` creates or adopts a store.
- `jtrek agent install`, `jtrek agent --check` and `jtrek agent uninstall` manage the agent instructions.
- `jtrek view` serves the store in a browser.
- `jtrek query` and `jtrek history` read records.
- `jtrek start` and `jtrek handoff` gather what a session needs when it opens and when it closes.
- `jtrek plan progress` reports each plan section's progress.
- `jtrek cross-review` starts the cross-family reviewer of a finished feature or plan section. It runs the agent named in the `cross_review` block of `jtrek.json` read-only, and prints the agent's report.
- `jtrek check`, `jtrek build --check` and `jtrek agent --check` are the gates.
- `jtrek migrate` rebuilds a store for a newer release's format.

The agent runs the commands that write to the store: `jtrek checkout`, `jtrek checkin` and `jtrek build`.

## Further reading

After setup, the documents under `jtrek/docs/` in the project describe the store in full:

- `rules.md` covers the rules for writing to the store.
- `schema.md` covers every field of a record and how records relate to each other.
- `glossary.md` defines the terms these documents use.
- `opening-a-session.md`, `closing-a-session.md`, `session.md`, `planning.md`, `writing-code.md`, `reviewing.md`, `review-refactor.md`, `review-cross.md`, `review-arbitrate.md` and `review-report.md` hold the procedures the slash commands load.
- `map-overall.md` draws the whole of jtrek's workflow conceptually, from adopting jtrek to the review of a finished feature. It shows only the nodes that do work and the questions that decide which work is done.
- `map-work.md` draws one session of code or other work, from the branch it runs on to the close of the session. It has a flowchart, a card for each node and a table of the principles each node holds.
- `map-review.md` draws the review of a finished feature or plan section, whose set-up and four stages each run in a session of their own. It has a flowchart, a card for each node and a table of the principles each node holds.

## Terms of use

jtrek is released under the MIT License, whose text is in [`LICENSE`](LICENSE). Anyone who receives a copy may use, copy, modify and redistribute it, provided the copyright notice and the license text travel with it.
