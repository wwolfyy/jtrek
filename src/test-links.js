/**
 * src/test-links.js — the link between a requirement in force and the test that verifies it.
 *
 * A requirement is in force once it is `done` and not superseded, and `R-000371` decided that it
 * reaches `done` only in the check-in that lands a passing test for it. That test is linked in two
 * places, one on each side. The requirement's `files` names the test file, and the test file names
 * the requirement's id, usually in the name of the test case. The first lets a reader of the
 * requirement find its test. The second lets a reader of a failing test find the requirement it
 * verifies.
 *
 * The `tests` group of `jtrek check` verifies both halves of that link, and this module holds the
 * comparison. It checks only that the link exists. It does not run the tests, because the command a
 * project runs its tests with is the project's own, and the closing procedure already tells a
 * session to run it. Whether the linked test passes is therefore the suite's job, and whether a
 * test is linked at all is this group's.
 *
 * `files` is resolved against the project root, because it holds repository paths. `detail_ref` is
 * resolved against the store directory instead, and the two are different on purpose.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isInForce } from './spec.js';

/**
 * Returns a pattern that finds `id` where it stands as a whole id.
 *
 * A bare substring search is not enough, because one store holds ids of two lengths. Records
 * written before ids were padded to six digits keep four, so `R-0001` is the first seven
 * characters of `R-000123`. The pattern therefore refuses a match followed by another digit, and a
 * match preceded by a letter, a digit or a hyphen.
 */
function wholeId(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9-])${escaped}(?!\\d)`);
}

/**
 * Finds the requirements in force whose link to a test is missing or broken.
 *
 * Each requirement in force falls into one of three failures, or into none. It names no file in
 * `files`. It names files, but none of them exists. Or some of them exist, but none of those
 * contains the requirement's id as a whole id. A requirement that fails an earlier question is not
 * asked the later ones, because a later answer would only restate the earlier failure.
 */
export function inspectTestLinks(records, projectRoot) {
  const inForce = records.filter(isInForce);
  const unnamed = [];
  const missing = [];
  const unmentioned = [];

  for (const record of inForce) {
    const files = record.files ?? [];
    if (files.length === 0) {
      unnamed.push({ id: record.id });
      continue;
    }
    const existing = files.filter((file) => {
      const full = path.resolve(projectRoot, file);
      return fs.existsSync(full) && fs.statSync(full).isFile();
    });
    if (existing.length === 0) {
      missing.push({ id: record.id, files });
      continue;
    }
    const pattern = wholeId(record.id);
    const mentions = existing.some((file) =>
      pattern.test(fs.readFileSync(path.resolve(projectRoot, file), 'utf8'))
    );
    if (!mentions) unmentioned.push({ id: record.id, files: existing });
  }

  return { inForce: inForce.length, unnamed, missing, unmentioned };
}

/**
 * Turns what `inspectTestLinks` found into the lines that `jtrek check` prints.
 *
 * It returns the shape `specFindings` returns. A store with no requirement in force is reported as
 * not checked rather than as passing, because in that store the group read nothing.
 */
export function testLinkFindings(found) {
  if (found.inForce === 0) {
    return {
      checked: false,
      summary: 'no requirement is in force, so there is no link to a test to check.',
      problems: [],
      remedies: [],
    };
  }

  const problems = [];
  const remedies = [];
  for (const { id } of found.unnamed) {
    problems.push(`${id} is in force and names no file in 'files'.`);
  }
  for (const { id, files } of found.missing) {
    problems.push(`${id} is in force, and none of the files it names exists: ${files.join(', ')}.`);
  }
  for (const { id, files } of found.unmentioned) {
    problems.push(
      `${id} is in force, but none of the files it names contains its id: ${files.join(', ')}.`
    );
  }
  if (problems.length > 0) {
    remedies.push(
      'A requirement is in force only once a passing test verifies it. Name that test file in ' +
        "the requirement's 'files', and put the requirement's id in the test, usually in the name " +
        'of the test case. If no test verifies it yet, add a revision moving the requirement back ' +
        "to 'planned', with a note saying that it is agreed and that its test is not written yet."
    );
  }

  return {
    checked: true,
    summary:
      `each of the ${found.inForce} requirement(s) in force names a file that exists and contains ` +
      'its id.',
    problems,
    remedies,
  };
}
