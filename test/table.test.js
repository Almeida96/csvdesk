import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCSV, serializeCSV } from '../src/csv.js';
import { createTable, analyze, cleanTable, viewRows, exportRows } from '../src/table.js';

test('pads short rows and headers without dropping extra fields', () => {
  const table = createTable([['name'], ['Ana', 'Rio'], ['Ivo']]);
  assert.deepEqual(table.headers, ['name', '']);
  assert.deepEqual(table.rows, [['Ana', 'Rio'], ['Ivo', '']]);
  assert.equal(table.uneven, 2);
});
test('keeps duplicate and empty header names in their original positions', () => {
  const table = createTable([['id', 'id', ''], ['001', '002', 'x']]);
  assert.deepEqual(exportRows(table, [0], [0, 1, 2]), [['id', 'id', ''], ['001', '002', 'x']]);
});
test('headerless imports keep their first row and omit generated names on export', () => {
  const table = createTable([['001', 'Ana'], ['002', 'Ivo']], false);
  assert.deepEqual(table.headers, ['Column 1', 'Column 2']);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(exportRows(table, [0, 1], [1]), [['Ana'], ['Ivo']]);
});
test('accepts header-only files and rejects empty input', () => {
  assert.deepEqual(createTable([['id']]).rows, []);
  assert.throws(() => createTable([]), /empty/);
});
test('rejects oversized padded tables and headerless data over the row limit', () => {
  const rows = Array.from({ length: 5001 }, () => ['']); rows[0] = Array(100).fill('');
  assert.throws(() => createTable(rows), /500,000/);
  assert.throws(() => createTable(Array.from({ length: 50001 }, () => ['']), false), /50,000/);
});
test('reports empty rows, empty cells, edge spaces, duplicates, and formulas', () => {
  const table = createTable([['a', 'b'], ['  ', ''], ['x', '=1'], ['x', '=1']]);
  assert.deepEqual(analyze(table), { empty: 1, blank: 1, spaces: 1, formulas: 2, duplicates: 1 });
});
test('trimming changes data cells only and preserves the previous table', () => {
  const table = createTable([[' id '], [' 001 ']]);
  const result = cleanTable(table, 'trim');
  assert.deepEqual(result.table.headers, [' id ']);
  assert.deepEqual(result.table.rows, [['001']]);
  assert.equal(result.changed, 1);
  assert.deepEqual(table.rows, [[' 001 ']]);
});
test('duplicate removal uses complete rows and retains the first occurrence', () => {
  const table = createTable([['a', 'b'], ['a,b', 'c'], ['a', 'b,c'], ['a,b', 'c']]);
  const result = cleanTable(table, 'duplicates');
  assert.equal(result.changed, 1);
  assert.deepEqual(result.table.rows, [['a,b', 'c'], ['a', 'b,c']]);
});
test('cleanup order is explicit and no-op cleanup keeps the same table', () => {
  const table = createTable([['id'], [' a '], ['a'], [' '], ['']]);
  assert.equal(cleanTable(table, 'duplicates').changed, 0);
  const trimmed = cleanTable(table, 'trim').table;
  assert.equal(cleanTable(trimmed, 'duplicates').changed, 2);
  assert.equal(cleanTable(table, 'empty').changed, 2);
  const cleaned = cleanTable(trimmed, 'empty').table;
  assert.equal(cleanTable(cleaned, 'empty').table, cleaned);
});
test('search treats punctuation literally and matches all columns case-insensitively', () => {
  const table = createTable([['id', 'name'], ['1', 'Ana [Rio]'], ['2', 'Ivo'], ['3', '<script>']]);
  assert.deepEqual(viewRows(table, 'ANA'), [0]);
  assert.deepEqual(viewRows(table, '['), [0]);
  assert.deepEqual(viewRows(table, '<script>'), [2]);
  assert.deepEqual(viewRows(table, 'missing'), []);
});
test('natural text sorting is stable and leaves source row order intact', () => {
  const table = createTable([['id'], ['item10'], ['item2'], ['item2'], ['item1']]);
  assert.deepEqual(viewRows(table, '', 0), [3, 1, 2, 0]);
  assert.deepEqual(viewRows(table, '', 0, 'desc'), [0, 1, 2, 3]);
  assert.deepEqual(table.rows[0], ['item10']);
});
test('exports exactly the selected columns and filtered sorted rows', () => {
  const table = createTable([['sku', 'name', 'group'], ['002', 'B', 'yes'], ['001', 'A', 'yes'], ['003', 'C', 'no']]);
  const output = exportRows(table, viewRows(table, 'yes', 0), [0, 1]);
  assert.deepEqual(parseCSV(serializeCSV(output)), [['sku', 'name'], ['001', 'A'], ['002', 'B']]);
  assert.throws(() => exportRows(table, [0], []), /at least one/);
  assert.throws(() => exportRows(table, [99], [0]), /row/);
  assert.throws(() => exportRows(table, [0], [3]), /column/);
});
test('sample cleanup removes the expected records and round trips all fields', () => {
  let table = createTable(parseCSV(readFileSync(new URL('../sample.csv', import.meta.url), 'utf8')));
  assert.equal(table.rows.length, 24);
  assert.equal(analyze(table).duplicates, 2);
  assert.equal(analyze(table).empty, 1);
  for (const operation of ['trim', 'empty', 'duplicates']) table = cleanTable(table, operation).table;
  assert.equal(table.rows.length, 21);
  assert.deepEqual(analyze(table), { empty: 0, blank: 1, spaces: 0, formulas: 0, duplicates: 0 });
  const rows = exportRows(table, viewRows(table), [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(parseCSV(serializeCSV(rows)), rows);
});
