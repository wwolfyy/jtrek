# Moving a jtrack project to jtrek

jtrek was called jtrack until 2026-10-29. jtrek does not read a project that still uses jtrack's names. It refuses a `jtrack/` store, a `jtrack.json` file and the variable `JTRACK_STORE`, and it does not load a registry whose header says `jtrack_schema`. This manual brings such a project, at any earlier format that a command can migrate, under jtrek's names.

The npm package called `jtrack` is an unrelated tool, so do not install it. The old command `jtrack` that this manual runs is the release of jtrack already installed on the machine.

The procedure rewrites the first line of the registry and the `chain` value of every row, and it moves the store's files. It changes nothing else in any row. The text of older records keeps saying `jtrack`, because the store is append-only. `jtrek agent install` adds a paragraph to the project's agent instructions that explains the old name.

## Before starting

1. **Find the store and its format.** The store is usually the directory `jtrack/`, or the directory that the `store` key of `jtrack.json` names. Read the first line of its registry with `head -n 1 jtrack/registry.ndjson`. If that line is `{"jtrack_schema":1}`, the store is at format version 1. If it is an ordinary row with no such key, the store is at format version 0, which is older than the `chain` value.
2. **Finish any open checkout** with `jtrack checkin`. The migration refuses an open checkout.
3. **Commit everything.** Git is the only backup a store has, and the commands refuse uncommitted changes to the files they touch.

jtrek needs Node.js 24 or later. Each step below ends in a commit, so that any step can be undone with git.

## Step 1 — Bring the store to format version 1, if it has no header

Skip this step when the first line of the registry is `{"jtrack_schema":1}`. `jtrek migrate --from-jtrack` reads only format version 1, and it refuses a store with no header.

**With the old command available,** run it and commit the result:

```bash
jtrack migrate
git add -A && git commit -m "Rebuild the store at format version 1"
```

**Without the old command,** rename the files by hand and let `jtrek migrate` rebuild the store. Install jtrek as Step 2 describes, and then run the following, leaving out any file the project does not have. Step 3 is then already done, so go on to Step 4.

```bash
git mv jtrack jtrek
git mv jtrack.json jtrek.json     # then change its "store" value from "jtrack" to "jtrek"
git mv jtrek/jtrack_plan.md jtrek/jtrek_plan.md
git mv jtrek/jtrack_spec.md jtrek/jtrek_spec.md
git mv jtrek/jtrack_handoff.md jtrek/jtrek_handoff.md
git mv jtrek/jtrack_architecture.md jtrek/jtrek_architecture.md
git add -A && git commit -m "Rename the store's files to jtrek"
jtrek migrate
git add -A && git commit -m "Rebuild the store at format version 1"
```

**A row with no `detail_ref` cannot be migrated.** The field became required on 2026-09-21, so a store whose rows were written before then may lack it. Both routes above then stop with the message `NOT NULL constraint failed: records.detail_ref`, and they write nothing. No command fills the field in, and the rules of the store forbid editing `registry.ndjson` by hand. Such a store stays as it is, and no route to jtrek exists for it today.

## Step 2 — Install jtrek

```bash
npm i -g "github:wwolfyy/jtrek#<tag>"
```

Name the newest tag, which `git ls-remote --tags https://github.com/wwolfyy/jtrek` lists. Keep the old command installed until Step 5.

## Step 3 — Move the store to jtrek's names

A store directory called `.jtrack/` or `work_tracking/` is found only if `jtrack.json` names it. If neither `jtrack.json` nor a `jtrack/` directory exists, the command reports that it found no store. Move the directory first with `git mv .jtrack jtrack`, and commit.

```bash
jtrek migrate --from-jtrack
git add -A && git commit -m "Move the store to jtrek's names"
```

The command verifies the old `chain` values, moves each file with `git mv`, rewrites the header to `{"jtrek_schema":1}`, and recomputes every row's `chain`. A directory that `jtrack.json` names under another name keeps that name. The command commits nothing itself. Until the commit, `jtrek check` reports `history` as NOT CHECKED or FAILED, and that is the gate working as intended.

If the command refuses, it says why and writes nothing. A chain that does not verify means that a row was edited by hand, and the migration does not hide that.

## Step 4 — Rename plan sections and install the agent instructions

Older stores name plan sections by number, such as `§5`. Find out whether this one does:

```bash
jtrek query --query "plan LIKE '§%'"
```

If that lists any row, rename them. The slug of each section comes from its title unless `--slug §N=<slug>` names it, and the command writes nothing if a row names a number that the plan has no heading for.

```bash
jtrek migrate --plan-slugs
git add -A && git commit -m "Name plan sections by slug"
```

Then write the agent instructions and regenerate the store's views. The project's use of Claude Code carries over, so the command needs no option for it.

```bash
jtrek agent install
jtrek build
git add -A && git commit -m "Install jtrek's agent instructions"
```

`jtrek agent install` also removes what jtrack installed in the project: its block in `AGENTS.md` and `CLAUDE.md`, the hooks that run `jtrack guard` and `jtrack threshold`, its skills and its rule file. It also corrects the commands named in the comments of the store's `.gitignore`. A `jtrack-*` skill that jtrack did not ship stays, because the project wrote it.

If an instruction file has jtrack's begin marker and no end marker, the command writes nothing and names the file, because nothing says where jtrack's text ends. Remove that block by hand and run the command again.

## Step 5 — Run the gates, and clean up

```bash
jtrek check
jtrek build --check
jtrek agent --check
```

All three must exit 0. `jtrek agent --check` fails while anything named in Step 4 remains. Then finish these by hand:

- Rename the variable `JTRACK_STORE` to `JTREK_STORE` wherever it is set, because jtrek refuses to run while the old one is set alone.
- Change any script or CI job that runs `jtrack`. `git grep -n "jtrack "` finds candidates, and it also finds the text of older records, which stays as it is.
- If the project used `jtrack agent install --user-hook`, the hooks in the user's own Claude Code settings still run `jtrack`. jtrek leaves that file alone, because another project on the machine may still use jtrack. Once none does, delete the hooks whose command is `jtrack guard` or `jtrack threshold` from `~/.claude/settings.json`, and run `jtrek agent install --user-hook`.
- Remove the old release with `npm uninstall -g jtrack`. That removes what is installed under the name, and it fetches nothing from the npm registry.

## What stays different afterwards

- **The text of older records says `jtrack`.** A command written there as `jtrack checkin` is run today as `jtrek checkin`. The instructions the agent reads explain this for as long as the store holds the name.
- **`jtrek check --since` cannot compare across the move.** A commit from before Step 3 holds no registry at the store's new path, so `history` reports NOT CHECKED. If the store's directory did not move, it reports FAILED instead, because every line was rewritten. To cover later work, give `--since` a commit made after the migration.
- **`jtrek agent --check` fails if `jtrek` is not on `PATH`,** because the guard hook runs that command. The guard allows every edit while the command is missing, so `jtrek check` is what catches a hand-edit in that case.
