/**
 * src/spec.js reads and renders a project's spec document.
 *
 * The spec document, `jtrek_spec.md`, says what the product does, one feature at a time.
 * `R-000201` decided its shape. Each feature has a heading of the form `## <slug> — <title>`, which
 * is the form a plan section's heading takes, followed by a paragraph that a person writes to say
 * what the feature is for. A requirement record names its feature by that slug in its `feature`
 * field, in the same way that a record names its plan section in its `plan` field. The two sets of
 * slugs are separate, because they name headings in two different documents.
 *
 * Under each feature's paragraph, a `### Requirements` heading begins the part that jtrek writes.
 * That part first names the plan section the feature belongs to, and then lists the statement of
 * every requirement in force that names the feature. It runs to the end of the feature's section. `jtrek build` rewrites it from the store, and nothing in it
 * is written by hand. The statements stay in the store because they must be exact, versioned and
 * searchable. The purpose stays in the document because only a person can write it.
 *
 * The boundary is a visible heading rather than an HTML comment. `R-0092` records that a markdown
 * editor can rewrite a file when it saves it, and HTML comments are among the markup such an editor
 * escapes or drops. `src/plan.js` puts the slug in a heading's visible text for the same reason.
 *
 * A feature belongs to exactly one plan section, as `R-000408` decided, so that the review of a
 * finished section that `R-000406` describes covers whole features. Nothing records the section
 * separately. It is worked out from the `plan` values of the requirements that name the feature,
 * so that it cannot fall out of step with them, and the `spec` group of `jtrek check` fails when
 * those requirements name more than one section.
 *
 * This module is the one place that knows what the rendered part looks like. `jtrek build` writes
 * it, `jtrek build --check` and the `spec` group of `jtrek check` compare it with the store, and
 * `jtrek plan spec` shows it with the records of an open checkout in place.
 */

import { compareIds } from './store.js';
import { sectionSpans, slugHeadings } from './plan.js';

/** The spec document's file name, inside the store's directory. */
export const SPEC_FILENAME = 'jtrek_spec.md';

/** The heading that begins the rendered part of a feature's section. */
export const REQUIREMENTS_HEADING = '### Requirements';

/** Matches the requirements heading on a line of its own, allowing trailing spaces. */
const REQUIREMENTS_LINE = /^### Requirements[ \t]*$/m;

/**
 * Tells whether a record is a requirement in force.
 *
 * This is the rule the `requirements_in_force` view in `schema.sql` states: a current requirement
 * that is `done` and not superseded. It is written out here as well because `jtrek plan spec`
 * applies it to records in `work.json`, which are not in any database. A test compares the two, so
 * that they cannot drift apart unnoticed.
 */
export function isInForce(record) {
  return (
    record.type === 'requirement' && record.status === 'done' && record.outcome !== 'superseded'
  );
}

/**
 * Tells whether a requirement counts towards the plan section of the feature it names.
 *
 * A requirement that is proposed, planned, deferred or in force still belongs to its feature, so it
 * counts. One that was abandoned or superseded no longer describes the product, so it does not, and
 * a feature can therefore move to another section by having its old requirements replaced.
 */
export function countsTowardsSection(record) {
  return (
    record.type === 'requirement' && record.status !== 'abandoned' && record.outcome !== 'superseded'
  );
}

/**
 * Returns, for each feature, the plan sections its counted requirements name.
 *
 * The result maps a feature's slug to a list of `{ plan, ids }`, ordered by the section's slug, in
 * which `ids` holds the requirements naming that section, in id order. A feature that no counted
 * requirement names has no entry.
 */
function sectionsByFeature(records) {
  const byFeature = new Map();
  for (const record of records.filter(countsTowardsSection).sort((a, b) => compareIds(a.id, b.id))) {
    const sections = byFeature.get(record.feature) ?? new Map();
    sections.set(record.plan, [...(sections.get(record.plan) ?? []), record.id]);
    byFeature.set(record.feature, sections);
  }
  const result = new Map();
  for (const [feature, sections] of byFeature) {
    const ordered = [...sections].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    result.set(feature, ordered.map(([plan, ids]) => ({ plan, ids })));
  }
  return result;
}

/** Returns the line that names a feature's plan section, given what `sectionsByFeature` found. */
function sectionLine(sections) {
  if (sections.length === 0) {
    return 'Plan section: none, because no requirement that is neither abandoned nor superseded names this feature.';
  }
  if (sections.length === 1) return `Plan section: \`${sections[0].plan}\`.`;
  return (
    `Plan sections: ${sections.map(({ plan }) => `\`${plan}\``).join(', ')}. A feature belongs to ` +
    'one plan section, so the `spec` group of `jtrek check` fails until its requirements name only one.'
  );
}

/** Makes a statement one line long, so that it cannot break the list it is rendered into. */
function oneLine(text) {
  return String(text ?? '').replace(/\s*\n\s*/g, ' ').trim();
}

/** Returns the rendered part of one feature's section, from its heading to its last line. */
function requirementsBlock(requirements, sections) {
  const lines = [REQUIREMENTS_HEADING, '', sectionLine(sections), ''];
  if (requirements.length === 0) {
    lines.push('_No requirement is in force._');
  } else {
    for (const record of requirements) lines.push(`- **${record.id}** ${oneLine(record.statement)}`);
  }
  return lines.join('\n');
}

/**
 * Returns the spec document with the rendered part of every feature's section rewritten.
 *
 * `text` is the spec document as it stands, and `records` holds the current revision of every
 * record, of any type. The plan section is worked out from every requirement that is neither
 * abandoned nor superseded, and only requirements in force are listed. Everything between a feature's
 * heading and its `### Requirements` heading is kept exactly as written. A section that has no
 * `### Requirements` heading gains one at its end, so that a feature a person has just added needs
 * nothing more than its heading and its paragraph. Headings that are not in the feature form, such
 * as an explanatory `## How this document works`, are left alone.
 *
 * Rendering the result a second time returns it unchanged. `jtrek build --check` relies on that,
 * because it compares the committed document with a fresh render.
 */
export function renderSpec(text, records) {
  const byFeature = new Map();
  for (const record of records.filter(isInForce).sort((a, b) => compareIds(a.id, b.id))) {
    byFeature.set(record.feature, [...(byFeature.get(record.feature) ?? []), record]);
  }
  const sections = sectionsByFeature(records);

  // The sections are rewritten from the last to the first, so that rewriting one does not move the
  // offsets of the sections still to be rewritten.
  let result = text;
  for (const span of sectionSpans(text).reverse()) {
    const body = result.slice(span.bodyStart, span.end);
    const found = body.search(REQUIREMENTS_LINE);
    const written = (found === -1 ? body : body.slice(0, found)).trimEnd();
    const block = requirementsBlock(byFeature.get(span.slug) ?? [], sections.get(span.slug) ?? []);
    // A section followed by another heading ends in a blank line, and the last section ends the
    // file with a single newline.
    const tail = span.end < result.length ? '\n\n' : '\n';
    result = `${result.slice(0, span.bodyStart)}${written}\n\n${block}${tail}${result.slice(span.end)}`;
  }
  return result;
}

/**
 * Compares the `feature` value of each requirement with the headings of a spec document.
 *
 * `text` is the spec document, or null when there is none, and `records` holds the current revision
 * of every record. Every requirement is compared, whatever its status, for the reason
 * `inspectPlan` in `src/plan.js` gives for comparing every record with the plan. Only a requirement
 * carries a `feature`, because `schema.sql` refuses the field on every other type.
 *
 * `spanning` lists each feature whose counted requirements name more than one plan section, with
 * the sections and the requirements naming each.
 *
 * `stale` is true when the rendered part of the document no longer equals the store. It is the
 * comparison `jtrek build --check` makes, so the `spec` group of `jtrek check` reports the same
 * thing that gate does.
 */
export function inspectSpec(text, records) {
  const titlesBySlug = new Map();
  for (const heading of slugHeadings(text)) {
    titlesBySlug.set(heading.slug, [...(titlesBySlug.get(heading.slug) ?? []), heading.title]);
  }
  const requirements = records.filter((record) => record.type === 'requirement');
  return {
    specExists: text !== null,
    features: titlesBySlug.size,
    requirements: requirements.length,
    unknown: requirements.filter((record) => !titlesBySlug.has(record.feature)),
    duplicates: [...titlesBySlug]
      .filter(([, titles]) => titles.length > 1)
      .map(([slug, titles]) => ({ slug, titles })),
    spanning: [...sectionsByFeature(records)]
      .filter(([, sections]) => sections.length > 1)
      .map(([feature, sections]) => ({ feature, sections })),
    stale: text !== null && renderSpec(text, records) !== text,
  };
}

/**
 * Turns what `inspectSpec` found into the lines that `jtrek check` prints.
 *
 * It returns the same shape as `planFindings` in `src/plan.js`, for the same reasons. A project with
 * no spec document and no requirement is reported as not checked rather than as passing.
 */
export function specFindings(found, specPath) {
  if (!found.specExists && found.requirements === 0) {
    return {
      checked: false,
      summary: `there is no spec document at ${specPath}, and the store holds no requirement.`,
      problems: [],
      remedies: [],
    };
  }

  const problems = [];
  const remedies = [];
  if (!found.specExists) {
    problems.push(`There is no spec document at ${specPath}, so no requirement can name a feature.`);
    remedies.push("'jtrek agent install' creates the spec document from its starting template.");
  }
  for (const record of found.unknown) {
    problems.push(
      `${record.id} (${record.status}) names feature '${record.feature}', which ${specPath} has ` +
        `no heading for.`
    );
  }
  if (found.specExists && found.unknown.length > 0) {
    remedies.push(
      'Either add the feature to the spec document as a heading with a paragraph saying what it ' +
        'is for, or give each requirement listed a revision naming a feature the spec has.'
    );
  }
  for (const { slug, titles } of found.duplicates) {
    problems.push(
      `${titles.length} headings in ${specPath} begin with the slug '${slug}': ` +
        `${titles.map((title) => `'${title}'`).join(', ')}. A slug names one feature, so a ` +
        `requirement naming '${slug}' cannot say which of them it belongs to.`
    );
  }
  if (found.duplicates.length > 0) {
    remedies.push(
      'Give one of the features a slug of its own, and give each requirement that belongs under it ' +
        'a revision naming that slug.'
    );
  }
  for (const { feature, sections } of found.spanning) {
    const named = sections.map(({ plan, ids }) => `'${plan}' (${ids.join(', ')})`);
    problems.push(
      `The requirements of feature '${feature}' name ${sections.length} plan sections: ` +
        `${named.slice(0, -1).join(', ')} and ${named.at(-1)}. A feature belongs to one plan ` +
        `section, so that the review of a finished section covers the whole feature.`
    );
  }
  if (found.spanning.length > 0) {
    remedies.push(
      'Give the requirements of each feature listed revisions that name one plan section, or split ' +
        'the feature into features that each belong to one section.'
    );
  }
  if (found.stale) {
    problems.push(
      `The requirements rendered in ${specPath} do not equal the store, or a feature's section has ` +
        `no '${REQUIREMENTS_HEADING}' heading yet.`
    );
    remedies.push("Run 'jtrek build' and commit the result.");
  }

  return {
    checked: true,
    summary:
      `each of the ${found.requirements} requirement(s) names one of the ${found.features} ` +
      `feature(s) in ${specPath}, no two features share a slug, each feature's requirements name ` +
      `one plan section, and the rendered requirements equal the store.`,
    problems,
    remedies,
  };
}
