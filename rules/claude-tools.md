# Writing to the jtrek store in Claude Code

{{SHARED:generated-banner}}

**Write every file under [`{{STORE}}`]({{STORE}}) with the file-editing tools `Edit`, `Write`, `MultiEdit` or `NotebookEdit`, and not with a command run through `Bash`.** This covers `work.json`, the prose files in `records/`, the plan and the hand-off. It holds even where another instruction says that the shell is an acceptable way to edit files.

**The reason is the guard.** This project's `.claude/settings.json` runs `jtrek guard` before every call to one of those four tools, and the guard refuses a call that would write `registry.ndjson` by hand. Claude Code runs that hook for those four tools only. A file written through `Bash`, whether by `sed`, a heredoc, a redirect or a script, is never shown to the guard, so a mistaken write to `registry.ndjson` made that way is not refused.

**This is about writing files by hand, and nothing else.** The `jtrek` commands write the store themselves and are run through `Bash`, which is how the store is meant to be written. Commands that only read, such as `jtrek query` or `git diff`, are unaffected.
