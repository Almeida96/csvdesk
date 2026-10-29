import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTable, deduplicate } from '../src/table.js';

test('matches a business key and keeps first or last in original order', () => {
  const table = createTable([['email', 'name'], ['a@test', 'Old'], ['b@test', 'B'], ['a@test', 'New']]);
  const before = structuredClone(table);
  assert.deepEqual(deduplicate(table, [0]).table.rows, [['a@test', 'Old'], ['b@test', 'B']]);
  assert.deepEqual(deduplicate(table, [0], { keep: 'last' }).table.rows, [['b@test', 'B'], ['a@test', 'New']]);
  assert.deepEqual(table, before);
});
test('normalizes comparison keys without modifying cell values and preserves incomplete keys', () => {
  const table = createTable([['id', 'name'], [' A ', 'First'], ['a', 'Second'], ['', 'X'], ['', 'Y']]);
  assert.equal(deduplicate(table, [0]).changed, 0);
  const result = deduplicate(table, [0], { trim: true, ignoreCase: true });
  assert.equal(result.changed, 1);
  assert.equal(result.table.rows[0][0], ' A ');
  assert.equal(deduplicate(table, [0], { skipBlank: false }).changed, 1);
});
test('composite keys cannot collide on separators, quotes or prototype names', () => {
  const table = createTable([['a', 'b'], ['a,b', 'c'], ['a', 'b,c'], ['__proto__', 'x'], ['__proto__', 'y']]);
  assert.equal(deduplicate(table, [0, 1]).changed, 0);
  for (const columns of [[], [0, 0], [-1], [2], ['0']]) assert.throws(() => deduplicate(table, columns));
});
