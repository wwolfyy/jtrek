/**
 * src/commands/guard.js implements `jtrek guard`, which refuses a direct write to
 * `registry.ndjson`.
 *
 * It runs as a `PreToolUse` hook in Claude Code. R1 says that the check-out and check-in loop is
 * the only way to write the registry, and R1 is the rule whose violation does the most damage. A
 * line edited by hand skips the trial insert, the computed `rev`, and the `(id, rev)` collision
 * check all at once. Breaking any other rule at least leaves the store loadable.
 *
 * This closes the ordinary route, and not every route. The hook's matcher covers the file-editing
 * tools. An agent that appends through a shell, for example with `echo … >> registry.ndjson`, is
 * not caught. Catching it would require the guard to parse shell command strings, which is a
 * heuristic that leaks. This is therefore a refusal on the path an agent usually takes, and not
 * enforcement.
 *
 * The shell route is not prevented, but its consequences are detected. `jtrek check` reads the
 * resulting file rather than asking who wrote it. A `>>` append that alters or reorders rows
 * already there therefore fails that gate, whichever tool produced it. That is why parsing shell
 * command strings stays rejected: the part of the problem the guard cannot catch reliably is
 * answered by inspecting the result instead. A well-formed line appended at the end of the file
 * used to escape both. The `chain` group of `jtrek check`, which `R-0036` added, now catches that
 * too, because such a line cannot carry the value that its position requires.
 *
 * The guard always fails open. An unparseable payload, an unknown payload shape, no store, or an
 * unexpected error all allow the call. A hook that failed closed on a surprise would block every
 * edit in the repository, which is far worse than a guard that occasionally misses.
 *
 * The gate that makes failing open tolerable is `jtrek check`, and not `jtrek build --check`.
 * This comment named the latter until 2026-08-25, and that was wrong. `build --check` compares
 * `registry.md` against a rebuild, so it sees only the seven fields that the table in that file
 * shows. `R-0038` measured the gap. On a store of 49 rows, tampering with a current revision went
 * unnoticed in 5 of 9 fields. Tampering with a superseded revision went unnoticed in every field,
 * because an old revision is never shown at all. `jtrek check` compares the file against its
 * committed history and reads no fields, so what it misses does not depend on what a table shows.
 *
 * Usage: this is not run by hand. `jtrek agent install --claude` installs the hook that runs it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findStore } from '../discovery.js';

/** These are the hook's exit codes. 0 allows the call, and 2 blocks it and returns the message. */
const ALLOW = 0;
const BLOCK = 2;

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/**
 * This reads the target paths from a hook payload, without assuming much about its shape.
 *
 * The payload is read defensively on purpose. This is the one place in jtrek that consumes a
 * format owned by somebody else. If that format changes shape, the guard must fall back to allowing
 * the call rather than to blocking everything.
 */
export function targetPaths(payload) {
  const input = payload?.tool_input ?? payload?.toolInput ?? {};
  const candidates = [input.file_path, input.filePath, input.path, input.notebook_path];
  for (const edit of input.edits ?? []) {
    candidates.push(edit?.file_path, edit?.filePath);
  }
  return candidates.filter((value) => typeof value === 'string' && value.length > 0);
}

/**
 * This returns the file that an absolute path actually names, with every symbolic link above it
 * followed.
 *
 * `path.resolve` is not enough on its own, and `R-000130` measured what it misses. It normalises a
 * path as text, making it absolute and collapsing `.` and `..`, and it never touches the
 * filesystem. The same file named through a symbolically linked directory therefore produces a
 * different string, and a comparison against that string misses it. `fs.realpathSync` is the call
 * that follows links.
 *
 * The fallbacks below narrow the gap rather than closing it, and that is deliberate.
 * `fs.realpathSync` throws on a file that does not exist, and creating a file names exactly such a
 * file. Throwing here would therefore refuse every new file. That would be failing closed, which
 * is the opposite of what this module promises. Resolving the parent directory instead still
 * follows any link above the file, which covers creating a file inside a linked store. Only when
 * neither the file nor its directory exists is the unresolved string used.
 */
export function realPath(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    // The file does not exist yet. Its directory usually does, and resolving the directory follows
    // the links that matter. Joining the name back on keeps the path pointing at the file about to
    // be written.
    try {
      return path.join(fs.realpathSync(path.dirname(target)), path.basename(target));
    } catch {
      // Neither exists, so there is nothing to follow and nothing to guard.
      return target;
    }
  }
}

export function run(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(
      'Usage: jtrek guard   (reads a PreToolUse hook payload on stdin; not run by hand)\n'
    );
    return ALLOW;
  }

  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    return ALLOW;
  }

  const paths = targetPaths(payload);
  if (paths.length === 0) return ALLOW;

  // This uses the working directory named in the payload, rather than this process's own. The
  // hook runs wherever the agent was launched, which is not necessarily where the edit is aimed.
  const cwd = payload.cwd ?? process.cwd();

  // Each target is kept in two forms. The first is the spelling the payload used, so that the
  // refusal names the file the way the agent named it. The second is the file that spelling
  // resolves to, which is what gets compared. A relative spelling is resolved against the agent's
  // working directory from the payload, because that is the directory it was written relative to.
  const targets = paths.map((spelling) => ({
    spelling,
    real: realPath(path.resolve(cwd, spelling)),
  }));

  // The search for a store starts from the file being edited, and `R-0035` explains why. Searching
  // upwards from the agent's working directory alone leaves a store unguarded whenever the agent
  // was launched outside it. It also compares against the wrong store entirely when a second
  // jtrek project is open. The working directory stays in the list as well, rather than being
  // replaced. A `jtrek.json` that names a store outside the project can be reached from the
  // working directory, and from nowhere above the target.
  const starts = new Set([cwd, ...targets.map((target) => path.dirname(target.real))]);

  // The map is keyed by the registry's real path, which is the form a target is compared against.
  const guarded = new Map();
  for (const start of starts) {
    try {
      const found = findStore({ cwd: start });
      guarded.set(realPath(found.registryPath), found);
    } catch {
      // No store above this directory means there is nothing here to guard. That is not an error,
      // because most edits an agent makes are outside any store.
    }
  }
  if (guarded.size === 0) return ALLOW;

  const target = targets.find((candidate) => guarded.has(candidate.real));
  if (!target) return ALLOW;
  const hit = target.spelling;
  const store = guarded.get(target.real);

  process.stderr.write(
    `jtrek: refusing to edit ${hit} directly.\n\n` +
      `registry.ndjson is append-only and is written by 'jtrek checkin' alone. Editing it by ` +
      `hand skips the dry-run insert, the computed rev, and the (id, rev) collision check.\n\n` +
      `Use the loop instead:\n` +
      `  jtrek checkout --id R-XXXX   (or --new to add a record)\n` +
      `  edit ${path.join(path.relative(cwd, store.dir) || '.', 'work.json')}\n` +
      `  jtrek checkin\n` +
      `  jtrek build\n\n` +
      `Correct a mistake with the next revision, never by editing the line that was wrong.\n`
  );
  return BLOCK;
}
