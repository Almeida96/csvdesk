import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, serializeCSV, detectDelimiter, decodeFile, formulaLike, LIMITS } from '../src/csv.js';

test('reads quoted commas, doubled quotes, and multiline fields', () => {
  assert.deepEqual(parseCSV('name,note\r\n"Oak, small","He said ""yes""\r\nthen left"\r\n'), [
    ['name', 'note'], ['Oak, small', 'He said "yes"\r\nthen left'],
  ]);
});
test('preserves spaces, leading zeros, and numeric-looking values', () => {
  assert.deepEqual(parseCSV('0012,  value  ,1e9,+12,1.00'), [['0012', '  value  ', '1e9', '+12', '1.00']]);
});
for (const newline of ['\n', '\r', '\r\n']) {
  test(`supports ${JSON.stringify(newline)} records without inventing a trailing row`, () => {
    assert.deepEqual(parseCSV(`a,b${newline}c,d${newline}`), [['a', 'b'], ['c', 'd']]);
  });
}
test('keeps blank records and trailing empty cells', () => {
  assert.deepEqual(parseCSV('a,b\n\n,,\n'), [['a', 'b'], [''], ['', '', '']]);
  assert.deepEqual(parseCSV(','), [['', '']]);
  assert.deepEqual(parseCSV('""'), [['']]);
  assert.deepEqual(parseCSV('\n'), [['']]);
  assert.deepEqual(parseCSV(''), []);
  assert.deepEqual(parseCSV('\uFEFF'), []);
});
for (const delimiter of [',', ';', '\t', '|']) {
  test(`detects and parses separator ${JSON.stringify(delimiter)} outside quotes`, () => {
    const text = `sku${delimiter}note${delimiter}price\n001${delimiter}"comma, semicolon; pipe| and\nnew line"${delimiter}2.00\n`;
    assert.equal(detectDelimiter(text), delimiter);
    assert.deepEqual(parseCSV(text, delimiter), [['sku', 'note', 'price'], ['001', 'comma, semicolon; pipe| and\nnew line', '2.00']]);
  });
}
test('falls back to comma for a single-column file', () => {
  assert.equal(detectDelimiter('name\nAna\nIvo'), ',');
});
test('ignores empty records during separator detection', () => {
  assert.equal(detectDelimiter('\nname;city\n\nAna;Rio\n'), ';');
});
for (const [input, error] of [['a,"unclosed', /Unclosed.*line 1/], ['a,b"c', /Unexpected quote/], ['a,"b"c', /after a closing quote/], ['a\n"b\nc', /line 3/]]) {
  test(`rejects malformed quoting in ${JSON.stringify(input)}`, () => assert.throws(() => parseCSV(input), error));
}
test('enforces row, column, cell, and null-byte limits', () => {
  assert.throws(() => parseCSV('a,b,c', ',', { ...LIMITS, columns: 2 }), /columns/);
  assert.throws(() => parseCSV('a\nb', ',', { ...LIMITS, rows: 1 }), /data rows/);
  assert.throws(() => parseCSV('a,b\nc,d', ',', { ...LIMITS, cells: 3 }), /cells/);
  assert.throws(() => parseCSV('a\0b'), /null bytes/);
  assert.throws(() => parseCSV('a', ':'), /separator/);
});
test('decodes UTF-8, strips its BOM, and accepts Windows-1252 explicitly', () => {
  assert.equal(decodeFile(new TextEncoder().encode('\uFEFFcafé,São Paulo').buffer), 'café,São Paulo');
  const bytes = Uint8Array.from([99, 97, 102, 233]);
  assert.throws(() => decodeFile(bytes.buffer), /not valid UTF-8/);
  assert.equal(decodeFile(bytes.buffer, 'windows-1252'), 'café');
  assert.throws(() => decodeFile(Uint8Array.from([255, 254, 65, 0]).buffer), /UTF-16/);
  assert.throws(() => decodeFile(new ArrayBuffer(LIMITS.bytes + 1)), /10 MiB/);
});
test('exports CRLF, escaped quotes, delimiters, and optional BOM', () => {
  assert.equal(serializeCSV([['id', 'note'], ['001', 'He said "yes", once']], { bom: true }), '\uFEFFid,note\r\n001,"He said ""yes"", once"\r\n');
  assert.equal(serializeCSV([]), '');
});
test('quotes empty single-column records so a round trip retains them', () => {
  assert.deepEqual(parseCSV(serializeCSV([[''], ['a'], ['']])), [[''], ['a'], ['']]);
});
test('formula prefixing is explicit, covers headers too, and does not alter stored data', () => {
  const values = ['=1+2', '+sum(A1)', '-12', '@x', '\tvalue', '  =1', '＝1', 'normal'];
  const original = structuredClone(values);
  const rows = parseCSV(serializeCSV([values], { escapeFormulas: true }));
  assert.deepEqual(rows[0], values.map(value => formulaLike(value) ? `'${value}` : value));
  assert.deepEqual(values, original);
  assert.deepEqual(parseCSV(serializeCSV([values]))[0], values);
});
test('500 seeded tables survive CSV round trips with every supported separator', () => {
  let seed = 42;
  const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const parts = ['text', '', '"', ',', ';', '|', '\t', '\r\n', '  ', '001', 'é', '日本語', '=SUM(A1)'];
  for (let iteration = 0; iteration < 500; iteration++) {
    const width = 1 + random(8);
    const rows = Array.from({ length: 1 + random(10) }, () => Array.from({ length: width }, () => Array.from({ length: 1 + random(4) }, () => parts[random(parts.length)]).join('')));
    const delimiter = [',', ';', '\t', '|'][iteration % 4];
    assert.deepEqual(parseCSV(serializeCSV(rows, { delimiter, bom: true }), delimiter), rows);
  }
});
