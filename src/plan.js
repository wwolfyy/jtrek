/**
 * src/plan.js reads the sections of a project's plan document.
 *
 * The plan document, `jtrek_plan.md`, has one section per body of work, and every record names the
 * section it belongs to in its `plan` field. This module is the one place that knows what a section
 * heading looks like, so that `jtrek start`, which shows each candidate's section,
 * `jtrek plan check` and the `plan` group of `jtrek check`, which compare every record's section
 * with the plan, and `jtrek migrate --plan-slugs`, which rewrites the headings, cannot disagree
 * about it. The spec document names its features with headings of the same form, so `src/spec.js`
 * reads them through this module too.
 *
 * ## How a section is named
 *
 * `R-000180` decided that a section is named by a slug. A slug is a short lowercase name made of
 * letters and digits joined by single hyphens, such as `plan-surface`. It is chosen once, when the
 * section is created, and it never changes afterwards. The heading states it before the section's
 * title, as in `## plan-surface — The plan surface`, so that a person reading the plan and the code
 * reading it both see the same value.
 *
 * Sections used to be named by a number, as in `## §5 — The plan surface`, and records named that
 * number. A number describes a position. Inserting a section between two others renumbered every
 * later section, and every record naming one of those numbers then pointed at the wrong section.
 * A slug describes no position, so adding a section changes no record.
 *
 * The slug is written in the heading's visible text rather than as a markdown attribute such as
 * `{#plan-surface}` or as an HTML comment. `R-0092` records that a markdown editor can rewrite a
 * file when it saves it, and markup of that kind is what such an editor escapes or drops.
 *
 * `numberedSections` reads the older form, and only `jtrek migrate --plan-slugs` calls it. The rest
 * of jtrek reads slugs only. A plan that still has numbered headings therefore shows no sections
 * until it is migrated, and `jtrek start` names the migration when it finds a numbered value.
 */

/** The plan document's file name, inside the store's directory. */
export const PLAN_FILENAME = 'jtrek_plan.md';

/** A slug: lowercase letters and digits in groups joined by single hyphens. */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * A `plan` value in the older numbered form, such as `§5`.
 *
 * Some plans divided a section with a letter, such as `§7a`, so a number may end in lowercase
 * letters (`R-000658`). Any other suffix, such as the `-bis` of `§10s-bis`, is not part of a number.
 * `jtrek migrate --plan-slugs` refuses a value of that kind rather than passing over it (`R-000660`).
 */
export const NUMBERED = /^§\d+[a-z]*$/;

/**
 * A section heading in the current form: `## <slug> — <title>`.
 *
 * The title is required. Without it, an ordinary one-word heading such as `## Sessions` would read
 * as a section whose slug is `sessions`, and a plan's explanatory headings would become sections
 * that no record can belong to.
 */
const SLUG_HEADING = /^##\s+([a-z0-9]+(?:-[a-z0-9]+)*)\s+—\s+(.+)$/gm;

/**
 * A section heading in the older numbered form, written in either of two ways.
 *
 * The first is `## §N`, optionally followed by ` — <title>`, which is how jtrek wrote it. The second
 * is `## N. <title>`, with no `§` and a full stop after the number, which is how a plan written by
 * hand before it adopted jtrek may number its headings (`R-000659`). Its rows still name the section
 * as `§N`. In both forms, the number may end in lowercase letters, as `NUMBERED` explains.
 */
const NUMBERED_HEADING = /^##\s+(?:(§\d+[a-z]*)(?:\s+—\s+(.*))?|(\d+[a-z]*)\.\s+(.*))$/gm;

/**
 * Maps every slug that the plan document has a section for to that section's title and first line.
 *
 * The first line of prose under the heading says what that body of work is for. That purpose is the
 * only thing the plan document is authoritative about.
 */
export function planSections(text) {
  const sections = new Map();
  if (text === null) return sections;

  // A section's body runs to the next level-two heading of any kind, and not only to the next
  // section heading. Otherwise an explanatory heading such as "How this document works" would be
  // read as part of the section above it.
  const boundaries = [...text.matchAll(/^##\s/gm)].map((match) => match.index);
  for (const heading of text.matchAll(SLUG_HEADING)) {
    const from = heading.index + heading[0].length;
    const to = boundaries.find((index) => index > heading.index) ?? text.length;
    const body = text.slice(from, to).split('\n').map((line) => line.trim());
    sections.set(heading[1], {
      title: heading[2].trim(),
      purpose: body.find((line) => line.length > 0) ?? null,
    });
  }
  return sections;
}

/**
 * Returns every section in the current form, with the offsets at which it starts and ends.
 *
 * `start` is the offset of the heading, `bodyStart` is the offset just after the heading line, and
 * `end` is the offset of the next level-two heading of any kind, or the length of the text. The
 * spec document uses the same heading form as the plan, and `src/spec.js` calls this function to
 * find the part of each feature's section that it rewrites.
 */
export function sectionSpans(text) {
  if (text === null) return [];
  const boundaries = [...text.matchAll(/^##\s/gm)].map((match) => match.index);
  return [...text.matchAll(SLUG_HEADING)].map((heading) => ({
    slug: heading[1],
    title: heading[2].trim(),
    start: heading.index,
    bodyStart: heading.index + heading[0].length,
    end: boundaries.find((index) => index > heading.index) ?? text.length,
  }));
}

/**
 * Returns every section heading in the current form, in the order in which they appear.
 *
 * `planSections` keeps one entry per slug, so a slug that begins two headings appears there only
 * once. `jtrek plan check` has to find such a pair, so it reads every heading here instead.
 */
export function slugHeadings(text) {
  if (text === null) return [];
  return [...text.matchAll(SLUG_HEADING)].map((heading) => ({
    slug: heading[1],
    title: heading[2].trim(),
  }));
}

/**
 * Compares the `plan` value of each record with the sections of a plan document (`R-0016`).
 *
 * `text` is the plan document, or null when there is none, and `records` holds the current revision
 * of every record. `jtrek plan check` and the `plan` group of `jtrek check` both call this
 * function, so the two cannot disagree.
 *
 * A `plan` value that names no section means nothing, and nothing else reports it. `jtrek query`
 * answers a question about that value with no rows rather than with an error. Two sections that
 * share a slug make every record naming the slug ambiguous.
 *
 * Every record passed in is compared, whatever its status. A section's progress is derived from the
 * records naming it, closed ones included, so a finished record filed under a section the plan does
 * not have is as wrong as an open one. A record with no `plan` value is allowed.
 */
export function inspectPlan(text, records) {
  const titlesBySlug = new Map();
  for (const heading of slugHeadings(text)) {
    titlesBySlug.set(heading.slug, [...(titlesBySlug.get(heading.slug) ?? []), heading.title]);
  }
  const filed = records.filter((record) => record.plan);
  return {
    planExists: text !== null,
    sections: titlesBySlug.size,
    filed: filed.length,
    unfiled: records.length - filed.length,
    unknown: filed.filter((record) => !titlesBySlug.has(record.plan)),
    duplicates: [...titlesBySlug]
      .filter(([, titles]) => titles.length > 1)
      .map(([slug, titles]) => ({ slug, titles })),
  };
}

/**
 * Turns what `inspectPlan` found into the lines that both commands print.
 *
 * It returns `checked`, which is false when there was nothing to compare, a one-line `summary` for
 * a run with no problem, each `problem` found, and a `remedy` for each kind of problem found. A
 * project with no plan document and no record naming a section is reported as not checked rather
 * than as passing, because a line saying "ok" over a comparison of nothing would mislead a reader.
 */
export function planFindings(found, planPath) {
  if (!found.planExists && found.filed === 0) {
    return {
      checked: false,
      summary: `there is no plan document at ${planPath}, and no record names a section.`,
      problems: [],
      remedies: [],
    };
  }

  const problems = [];
  const remedies = [];
  if (!found.planExists) {
    problems.push(`There is no plan document at ${planPath}, so no plan value can name a section.`);
  }
  for (const record of found.unknown) {
    problems.push(
      `${record.id} (${record.status}) names plan section '${record.plan}', which ${planPath} has ` +
        `no heading for.`
    );
  }
  for (const { slug, titles } of found.duplicates) {
    problems.push(
      `${titles.length} headings in ${planPath} begin with the slug '${slug}': ` +
        `${titles.map((title) => `'${title}'`).join(', ')}. A slug names one section, so a record ` +
        `naming '${slug}' cannot say which of them it belongs to.`
    );
  }

  if (found.unknown.some((record) => NUMBERED.test(record.plan))) {
    remedies.push(
      "Plan sections are named by slug rather than by number, and 'jtrek migrate --plan-slugs' " +
        'renames the values that still name a number.'
    );
  } else if (found.unknown.length > 0) {
    remedies.push(
      'Either add the missing section to the plan document, or give each record listed a revision ' +
        'naming a section the plan has.'
    );
  }
  if (found.duplicates.length > 0) {
    remedies.push(
      'Give one of the sections a slug of its own, and give each record that belongs under it a ' +
        'revision naming that slug.'
    );
  }

  return {
    checked: true,
    summary:
      `each of the ${found.filed} record(s) with a plan value names one of the ${found.sections} ` +
      `section(s) in ${planPath}, and no two sections share a slug. ${found.unfiled} record(s) ` +
      `have no plan value, which is allowed.`,
    problems,
    remedies,
  };
}

/**
 * Returns every heading in the older numbered form, in the order in which they appear.
 *
 * Each entry holds the number, such as `§5`, the title, or null when the heading has none, and the
 * heading line exactly as written, so that the caller can replace that line and nothing else. A
 * heading written as `## 5. <title>` is given the number `§5`, because that is what its rows name.
 */
export function numberedSections(text) {
  return [...text.matchAll(NUMBERED_HEADING)].map((heading) => ({
    marker: heading[1] ?? `§${heading[3]}`,
    title: (heading[2] ?? heading[4])?.trim() || null,
    line: heading[0],
    index: heading.index,
  }));
}

/**
 * Derives a slug from a section's title, or returns null when the title yields none.
 *
 * The rule lowercases the title, drops a leading "the", "a" or "an", removes accents, and joins the
 * remaining runs of letters and digits with hyphens. "The plan surface" therefore becomes
 * `plan-surface`. The rule is applied once, when a section is given its slug. A title changed later
 * does not change the slug, because records already name it.
 */
export function deriveSlug(title) {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\s*(?:the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? null : slug;
}
