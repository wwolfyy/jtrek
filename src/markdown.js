/**
 * src/markdown.js detects the structural damage that a markdown editor leaves behind when it
 * rewrites a file. Each kind of damage it looks for is called a signature.
 *
 * Every signature here comes from damage this project actually recorded, and none comes from a
 * general idea of tidy markdown. `R-0119` is the decision to check for them, and `R-0092` records
 * the damage itself, revision by revision. A rule that nobody had seen cause harm would cost as
 * much to run as these do. It would also teach a reader that a finding from this module might be a
 * matter of taste, and none of these findings is.
 *
 * ## What produces the damage
 *
 * `R-0092` rev 14 identifies the cause. Orca's rich markdown editor parses a `.md` file into a
 * document model when it opens the file. When it saves, it converts that model back to markdown in
 * the serializer's own standard form. The editor's "Auto Save Files" setting then writes the buffer
 * to disk about a second after typing stops. An unsaved buffer therefore reaches the disk
 * rewritten, even though nobody asked for a rewrite.
 *
 * That cause explains the one feature that every instance shares. The rendered output stays exactly
 * the same, while the markers in the source move. A round trip through a document model preserves
 * meaning but not spelling. `R-0092` rev 13 measured a character-level diff that contained no
 * change to any letter or digit. Only `**` markers and backticks had moved.
 *
 * No setting turns this behaviour off. `R-0092` rev 14 established that from Orca's own
 * documentation and from the owner's settings. The only remedy for a file is a keystroke that
 * switches to the raw editor, and it has to be remembered every time a governed file is opened. A
 * protection that fails without warning the first time somebody forgets is the reason these checks
 * exist.
 *
 * ## Why this is not a markdown parser
 *
 * Each signature is a pattern in the text, found by scanning lines. Parsing the document would let
 * the checks be written against a syntax tree, but it would also mean bundling a parser, and this
 * tool has no dependencies. More importantly, a parser cannot see three of the signatures at all.
 * A non-breaking space, trailing whitespace and a missing final newline each produce the same
 * syntax tree as the correct text. The damage is in the exact characters, so the exact characters
 * are what this module reads.
 *
 * Each finding is reported with its line number and the text that matched, because several of
 * these signatures are invisible on screen. A report that gave only a count would leave the reader
 * unable to find them.
 */

/** The signatures. Each has a name, a description of what it means, and a way of finding it. */
const SIGNATURES = [
  {
    name: 'nbsp',
    title: 'a non-breaking space (U+00A0)',
    // R-0092 revs 1, 4 and 9 record this. A non-breaking space looks exactly like a space on
    // screen, so proofreading never catches it. It also prevents a literal string from matching.
    // Rev 4 records one surviving three attempts at repair before somebody inspected the bytes.
    // The pattern is deliberately written as an escape. A literal U+00A0 in this file would be
    // invisible to anyone reading the source of the check that looks for it.
    find: (lines) => matchesOf(lines, /\u00a0/g),
    remedy: 'Replace each one with an ordinary space. It is invisible on screen, so search by code point rather than by eye.',
  },
  {
    name: 'trailing-whitespace',
    title: 'trailing whitespace at the end of a line',
    // R-0092 revs 6, 8 and 9 record this as part of the same rewrites.
    find: (lines) =>
      lines
        .map((line, index) => ({ line: index + 1, text: line.slice(line.trimEnd().length), ok: line !== line.trimEnd() }))
        .filter((hit) => hit.ok)
        .map((hit) => ({ line: hit.line, text: `${hit.text.length} character(s) after the last visible one` })),
    remedy: 'Strip the spaces at the end of each line named.',
  },
  {
    name: 'code-span-in-emphasis',
    title: 'a code span whose content begins with emphasis markers',
    // R-0092 revs 6 and 8, and R-0083, record this. The damaged text reads `**x**` where **`x`**
    // was meant, and the asterisks are then shown literally.
    //
    // The damage also has a second form, and R-0092 revs 4, 5 and 12 recorded that form more often
    // than the first. It occurs when the bold span continues past the code span, as in
    // **`work.json` is gitignored**. The editor moves only the opening asterisks inside the
    // backticks, so the text becomes `**work.json` is gitignored**. The code span then holds the
    // opening asterisks and no closing ones. Until R-000174 this check required asterisks at both
    // ends of the span's content, so it did not report the second form. It now reports any span
    // whose content opens with two asterisks followed by something other than an asterisk. That
    // covers both forms. It still leaves alone a span holding only the marker itself, such as `**`,
    // which is how a sentence quotes the marker on purpose.
    //
    // Until 2026-09-18 this check used the plain pattern /`\*\*[^`]*\*\*`/, which R-000125
    // replaced. That pattern treated any backtick as an opening one. On a line with two correctly
    // written spans, such as **`a`** text **`b`**, it matched from the backtick that closes the
    // first span to the backtick that opens the second. It therefore reported the correct form as
    // an instance of the damage that the correct form avoids. The backticks have to be paired first
    // to tell an opening backtick from a closing one, and a pattern matched against a single line
    // cannot do that pairing.
    find: (lines) =>
      codeSpansOf(lines)
        .filter((span) => /^\*\*[^*]/.test(span.content))
        .map((span) => ({ line: span.line, text: `\`${span.content}\`` })),
    // R-000125 records the instance this remedy was written for. The id is kept in this comment
    // rather than in the printed text, because an adopting project's store does not contain that
    // record, as R-000132 noted.
    remedy:
      'The asterisks belong outside the backticks. Write **`x`** rather than `**x**`, which renders ' +
      'the asterisks literally. Where the literal asterisks ARE the point, because the sentence is ' +
      'quoting markdown source, escape them as \\*\\*x\\*\\* instead of fencing them: the rendered ' +
      'text is the same and the shape is no longer indistinguishable from the damage.',
  },
  {
    name: 'short-list-continuation',
    title: 'a list continuation line indented less than its marker requires',
    // R-0105 and R-0103 rev 2 record this. Most renderers do not show the damage. CommonMark's rule
    // for lazy continuation lines joins such a line back into its list item, so a conforming
    // renderer shows the right text and nothing appears wrong. The owner's renderer instead dropped
    // the first character of the line.
    find: findShortContinuations,
    remedy: 'Indent the line to the column where its list item\'s text begins. A conforming renderer hides this, so it is found by the indent rather than by reading the output.',
  },
  {
    name: 'emphasis-across-break',
    title: 'an emphasis span closed and reopened around a line break',
    // R-0092 rev 9 records this. It has been less likely since R-0117 removed hard wrapping, which
    // made each paragraph one long line. The check is kept because the damage can still occur and
    // looking for it costs almost nothing.
    find: (lines) => {
      const hits = [];
      for (let i = 0; i < lines.length - 1; i += 1) {
        const ends = /\*\*$/.test(lines[i].trimEnd());
        const begins = /^\s*\*\*/.test(lines[i + 1]);
        if (ends && begins) {
          hits.push({ line: i + 1, text: 'this line ends with ** and the next begins with **' });
        }
      }
      return hits;
    },
    remedy: 'One emphasis span was split in two across the break. Join them into a single span.',
  },
  {
    name: 'bold-split-by-link',
    title: 'a bold span broken into two around an inline link',
    // R-0119 rev 3 added this, based on R-0092 rev 13. A reader of the rendered page cannot see
    // this damage, because the rendered output is identical and only the source changes. The owner
    // included the check deliberately. An instance of it is evidence that the rewriting editor ran
    // on the file, and the same run may have made other changes that are visible.
    find: (lines) => matchesOf(lines, /\*\*[^*]*\*\*\s*\[[^\]]+\]\([^)]+\)\s*\*\*[^*]*\*\*/g),
    remedy: 'A single bold span containing a link was split into two spans either side of it. Rewrite it as one span. The rendered output is unchanged, so this is found in the source rather than by reading the page.',
  },
];

/**
 * Returns every code span on every line, with the text between its backticks. Backticks are paired
 * from left to right.
 *
 * Pairing is what distinguishes a backtick that opens a span from one that closes it. A regular
 * expression applied to a line cannot do this. It does not keep count of how many backticks it has
 * already passed, so it may begin a match on a closing backtick. `R-000125` records the false
 * finding that this produced.
 *
 * This deliberately implements only a small part of CommonMark, enough for the single-backtick
 * spans these documents use. A run of two or more backticks is skipped whole rather than paired, so
 * the content of a span written ``like this`` is not read. An unpaired backtick left at the end of
 * a line closes nothing and produces no span. In both cases the function reports fewer spans
 * rather than inventing one. That is the safe direction for a gate that fails a run.
 */
function codeSpansOf(lines) {
  const spans = [];
  lines.forEach((line, index) => {
    let i = 0;
    while (i < line.length) {
      if (line[i] !== '`') {
        i += 1;
        continue;
      }
      let run = 0;
      while (line[i + run] === '`') run += 1;
      if (run > 1) {
        i += run;
        continue;
      }
      const close = line.indexOf('`', i + 1);
      if (close === -1) break;
      spans.push({ line: index + 1, content: line.slice(i + 1, close) });
      i = close + 1;
    }
  });
  return spans;
}

/** Returns every match of `pattern`, with the line it was found on and the text that matched. */
function matchesOf(lines, pattern) {
  const hits = [];
  lines.forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      hits.push({ line: index + 1, text: match[0] === '\u00a0' ? 'U+00A0' : match[0] });
    }
  });
  return hits;
}

/**
 * Returns the continuation lines under a list item that are indented, but not as far as the column
 * where the item's text begins.
 *
 * A continuation line of a list item should be indented to the column where the item's own text
 * starts. A line with no indentation at all is an ordinary lazy continuation line, which is normal
 * markdown, so it is not reported. A line indented by some amount that falls short of that column
 * is what the rewriting editor leaves behind, and it is what the owner's renderer displays wrongly.
 */
function findShortContinuations(lines) {
  const MARKER = /^(\s*)([-*+]|\d+[.)])\s+/;
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    const marker = MARKER.exec(lines[i]);
    if (!marker) continue;
    const column = marker[0].length;

    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (line.trim() === '' || MARKER.test(line)) break;
      const indent = line.length - line.trimStart().length;
      if (indent > 0 && indent < column) {
        hits.push({ line: j + 1, text: `indented ${indent}, needs ${column}` });
      }
    }
  }
  return hits;
}

/**
 * Returns every signature found in one document's text.
 *
 * The missing final newline is checked here rather than in `SIGNATURES`, because it is a property
 * of the whole file, while every entry in that list reads individual lines. `R-0092` rev 12 records
 * it as part of the rewrite of `rules/pointer.md`. `R-0119` rev 1 listed five signatures and did not
 * include this one. A store that adopts the check should therefore expect it to find instances
 * that were already there.
 */
export function inspectDocument(text) {
  const lines = text.split('\n');
  const findings = [];

  for (const signature of SIGNATURES) {
    const hits = signature.find(lines);
    if (hits.length > 0) {
      findings.push({ name: signature.name, title: signature.title, remedy: signature.remedy, hits });
    }
  }

  if (text.length > 0 && !text.endsWith('\n')) {
    findings.push({
      name: 'no-final-newline',
      title: 'no terminating newline',
      remedy: 'Add a newline at the end of the file.',
      hits: [{ line: lines.length, text: 'the file ends mid-line' }],
    });
  }

  return findings;
}

/**
 * The names of all the signatures. They are exported for documentation, and for tests that check
 * that the list has not changed unnoticed.
 */
export const SIGNATURE_NAMES = [...SIGNATURES.map((s) => s.name), 'no-final-newline'];
