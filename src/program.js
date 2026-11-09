/**
 * src/program.js decides how to start a program that is named rather than given by its path, such
 * as the reviewer `jtrek cross-review` starts (R-000560).
 *
 * On Windows, Node finds a program given by its bare name on PATH only as a `.exe` or `.com` file.
 * npm, however, installs an agent such as Codex as a `.cmd` wrapper beside a shell script, so the
 * bare name is not found and starting it fails with ENOENT (R-000551). Finding the wrapper is not
 * enough by itself, because Node 24 refuses to start a `.cmd` or `.bat` file except through a shell.
 * On Windows this module therefore looks for the name with each extension that PATHEXT lists, in
 * each directory on PATH, and starts a wrapper it finds through the shell.
 *
 * When Node starts a program through a shell, it joins the file and the arguments with spaces and
 * hands the line to `cmd.exe`, which splits it again. Each part is therefore put in double quotes,
 * with any double quote inside it doubled, so that a part holding a space, such as the prompt given
 * to Gemini CLI or the path of a folder like `Program Files`, stays one argument.
 *
 * On every other platform, the bare name is returned unchanged, and the operating system finds the
 * program as it always has.
 */

import fs from 'node:fs';
import path from 'node:path';

const WRAPPER_EXTENSIONS = new Set(['.cmd', '.bat']);

/** Puts a part of a command line in double quotes for `cmd.exe`, doubling any quote inside it. */
function quoted(part) {
  return `"${part.replaceAll('"', '""')}"`;
}

/**
 * Returns the first file on PATH named `name` followed by an extension PATHEXT lists, searching the
 * directories in PATH's order and, in each, the extensions in PATHEXT's order. Returns null when
 * there is none. The extension is lowercased because npm writes its wrappers in lower case.
 */
function findOnWindowsPath(name, env) {
  const dirs = (env.PATH ?? '').split(';').filter(Boolean);
  const extensions = (env.PATHEXT ?? '').split(';').filter(Boolean);
  for (const dir of dirs) {
    for (const extension of extensions) {
      const candidate = path.join(dir, name + extension.toLowerCase());
      if (fs.statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
    }
  }
  return null;
}

/**
 * Returns the file, the arguments and the shell option with which `spawnSync` starts the program
 * `name` with the arguments `args`. `platform` and `env` default to those of the running process.
 *
 * When the program is not found on Windows, the bare name is returned, so that starting it fails as
 * it would without this lookup and the caller reports that the program could not be started.
 */
export function startCommand(name, args, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { file: name, args, shell: false };

  const found = findOnWindowsPath(name, env);
  if (found === null) return { file: name, args, shell: false };
  if (!WRAPPER_EXTENSIONS.has(path.extname(found))) return { file: found, args, shell: false };
  return { file: quoted(found), args: args.map(quoted), shell: true };
}
