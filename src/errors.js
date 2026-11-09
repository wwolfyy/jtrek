/**
 * src/errors.js defines the error types whose type decides the exit code of the binary.
 *
 * A `UsageError` means that the command was invoked wrongly. It does not mean that the command ran
 * and refused. `R-0024` drew that line. An unknown command, an unknown flag, a flag with no value,
 * and a selector that is missing or given twice are all mistakes by the caller, and they exit with
 * 2. Every other failure still exits with 1, including a refusal caused by the state of the store,
 * because in that case the command ran and reached a conclusion. The two codes mean different
 * things to a script. An exit code of 2 says that the invocation is wrong and will stay wrong until
 * somebody changes it. An exit code of 1 says that the store is in a state the command will not
 * accept.
 *
 * The error's type is the only thing that produces an exit code of 2, and nothing may widen that
 * by accident. The single `catch` at the bottom of `bin/jtrek.js` maps this type to 2 and every
 * other error to 1. An error that is not thrown as a `UsageError` therefore cannot produce 2,
 * however its message is worded.
 *
 * `jtrek guard` must never throw a `UsageError`. The guard runs as a Claude Code `PreToolUse`
 * hook, and for such a hook an exit code of 2 means "block the tool call". The guard module
 * promises that any unexpected failure lets the call through, because a hook that failed by
 * blocking would block every edit in the repository. `R-0025` rev 2 recorded this exemption, and
 * rev 3 stated it more precisely. What keeps the guard letting calls through is that an error that
 * escapes it becomes exit code 1 rather than 2. That behaviour belongs to the mapping in
 * `bin/jtrek.js`, which `guard.js` does not own, so any change to what that `catch` returns must
 * preserve it.
 */

/** Thrown when the caller's invocation is wrong. It exits with 2, as the note above explains. */
export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * The exit code for a usage error. It is given a name so that the mapping in `bin/jtrek.js` reads
 * as the rule it implements rather than as a bare number.
 */
export const USAGE_EXIT = 2;
