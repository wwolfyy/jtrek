/**
 * src/schema-doc.js — reads the meaning of each field of a record out of the schema document.
 *
 * The schema document, `schema.md`, explains every column of the records table in tables whose
 * first column is headed `Field`. Each such table has a row per field, whose first cell names the
 * field in backticks and whose other cells say what the field holds, such as its type, its values,
 * whether it is required and what it means. The tables differ in which of those columns they have.
 *
 * `jtrek cross-review` lists every column a query can name, with its meaning, in the instruction it
 * gives the reviewer (R-000568). It takes the meanings from here rather than from a description
 * written into the command, because `tests/schema-doc.test.js` already holds the document's tables
 * to `schema.sql`, and a second description would drift with nothing to catch it.
 */

/** Splits one row of a markdown table into its trimmed cells. */
function cells(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
}

/**
 * Returns a map from each field the document's `Field` tables describe to its description, which
 * joins every cell of the field's row except the first, each labelled with its column's heading, as
 * in "Type: integer; Required: yes; Meaning: Revision of this item".
 *
 * A table is a line starting with `|` whose next line is a delimiter row of dashes and colons.
 */
export function fieldDescriptions(text) {
  const descriptions = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const delimiter = lines[i + 1] || '';
    if (!lines[i].startsWith('|') || !/^\|[\s:|-]+\|$/.test(delimiter.trim())) continue;
    const header = cells(lines[i]);
    let j = i + 2;
    for (; j < lines.length && lines[j].startsWith('|'); j += 1) {
      if (header[0] !== 'Field') continue;
      const row = cells(lines[j]);
      const name = row[0].match(/^`([^`]+)`$/)?.[1];
      if (!name) continue;
      const parts = header.slice(1).map((heading, k) => `${heading}: ${row[k + 1] ?? ''}`);
      descriptions.set(name, parts.join('; '));
    }
    i = j - 1;
  }
  return descriptions;
}
