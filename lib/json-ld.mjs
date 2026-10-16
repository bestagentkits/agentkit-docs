/**
 * Serialize a value for a `<script type="application/ld+json">` body.
 *
 * `JSON.stringify` alone does not escape `<`, `>`, `&`, or the Unicode
 * LINE/PARAGRAPH SEPARATOR code points (U+2028/U+2029). Left unescaped, a
 * string value containing `</script>` breaks out of the script element, and
 * an unescaped U+2028/U+2029 is valid inside a JSON string but illegal
 * inside a raw JS string literal, which can make a browser misparse the
 * script body. Each substitution below is a JS `\uXXXX` escape sequence
 * that `JSON.parse` reads back to the original character, so this is
 * reversible, not lossy.
 *
 * Built from numeric code points (rather than typing the characters
 * directly) so the source never embeds a literal `<`/`>`/`&` or an actual
 * U+2028/U+2029 byte, which is easy to mistype or silently corrupt via
 * copy-paste.
 *
 * @param {unknown} data
 * @returns {string}
 */
const ESCAPES = [
  [0x3c, '\\u003c'], // <
  [0x3e, '\\u003e'], // >
  [0x26, '\\u0026'], // &
  [0x2028, '\\u2028'], // LINE SEPARATOR
  [0x2029, '\\u2029'], // PARAGRAPH SEPARATOR
];

export function jsonLdScript(data) {
  let json = JSON.stringify(data);
  for (const [codePoint, escape] of ESCAPES) {
    json = json.split(String.fromCodePoint(codePoint)).join(escape);
  }
  return json;
}
