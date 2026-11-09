/**
 * src/text.js — reading text files whatever their line endings.
 *
 * jtrek writes every file with LF line endings, and its gates compare files against text it
 * generates, or examine what ends each line. A file can reach jtrek with CRLF line endings instead.
 * Git for Windows installs with `core.autocrlf=true` by default, which checks every text file out
 * with CRLF, and an editor on Windows may save a file with CRLF. A file can also mix the two, for
 * example when `jtrek checkin` appends an LF line to a registry that git checked out with CRLF.
 * Before `R-000398` was fixed, all four gates failed on such a checkout of a sound store.
 *
 * Every command therefore reads a text file through `readText`, which turns each CRLF into LF, so a
 * file reads the same whatever its line endings (`R-000399`). A carriage return that is not followed
 * by a line feed is left alone, because it does not end a line.
 */

import fs from 'node:fs';

/** Returns `text` with every CRLF line ending turned into LF. */
export function toLf(text) {
  return text.replaceAll('\r\n', '\n');
}

/** Reads a UTF-8 text file with every CRLF line ending turned into LF. */
export function readText(filePath) {
  return toLf(fs.readFileSync(filePath, 'utf8'));
}

/**
 * Returns `text`, which has LF line endings, with CRLF line endings instead when `original` has
 * any. It is for a file that jtrek edits but does not own, so that the edit keeps the line endings
 * the project chose (`R-000400`). A file that mixed the two comes back with CRLF throughout.
 */
export function withLineEndingsOf(original, text) {
  if (original === null || !original.includes('\r\n')) return text;
  return toLf(text).replaceAll('\n', '\r\n');
}
