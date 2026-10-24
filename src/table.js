import { LIMITS, formulaLike } from './csv.js';

export function createTable(records, hasHeader = true) {
  if (!records.length) throw new Error('The file is empty.');
  const width = records.reduce((max, row) => Math.max(max, row.length), 0);
  if (records.length * width > LIMITS.cells) throw new Error('The table exceeds 500,000 cells after filling missing fields.');
  const pad = row => Array.from({ length: width }, (_, index) => row[index] ?? '');
  const data = hasHeader ? records.slice(1) : records;
  if (data.length > 50000) throw new Error('More than 50,000 data rows.');
  return {
    headers: hasHeader ? pad(records[0]) : Array.from({ length: width }, (_, i) => `Column ${i + 1}`),
    rows: data.map(pad),
    hasHeader,
    uneven: records.filter(row => row.length !== width).length,
  };
}

export function analyze(table) {
  let empty = 0, blank = 0, spaces = 0, formulas = 0;
  const seen = new Set();
  for (const row of table.rows) {
    if (row.every(cell => cell.trim() === '')) empty++;
    for (const cell of row) {
      if (cell === '') blank++;
      if (cell.trim() !== cell) spaces++;
      if (formulaLike(cell)) formulas++;
    }
    seen.add(JSON.stringify(row));
  }
  return { empty, blank, spaces, formulas, duplicates: table.rows.length - seen.size };
}

export function cleanTable(table, operation) {
  let rows, changed = 0;
  if (operation === 'trim') {
    rows = table.rows.map(row => row.map(cell => {
      const next = cell.trim();
      if (next !== cell) changed++;
      return next;
    }));
  } else if (operation === 'empty') {
    rows = table.rows.filter(row => row.some(cell => cell.trim() !== ''));
    changed = table.rows.length - rows.length;
  } else if (operation === 'duplicates') {
    const seen = new Set();
    rows = table.rows.filter(row => {
      const key = JSON.stringify(row);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    changed = table.rows.length - rows.length;
  } else throw new Error('Unknown cleanup operation.');
  return { table: changed ? { ...table, rows } : table, changed };
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function viewRows(table, query = '', column = -1, direction = 'asc') {
  const needle = query.toLowerCase();
  const indices = [];
  for (let i = 0; i < table.rows.length; i++) {
    if (!needle || table.rows[i].some(cell => cell.toLowerCase().includes(needle))) indices.push(i);
  }
  if (column >= 0 && column < table.headers.length) {
    indices.sort((a, b) => collator.compare(table.rows[a][column], table.rows[b][column]) * (direction === 'desc' ? -1 : 1));
  }
  return indices;
}

export function exportRows(table, indices, columns, includeHeader = table.hasHeader) {
  if (!columns.length) throw new Error('Select at least one column.');
  if (columns.some(column => !Number.isInteger(column) || column < 0 || column >= table.headers.length)) throw new Error('Invalid export column.');
  const select = row => columns.map(column => row[column]);
  return [...(includeHeader ? [select(table.headers)] : []), ...indices.map(index => {
    if (!Number.isInteger(index) || !table.rows[index]) throw new Error('Invalid export row.');
    return select(table.rows[index]);
  })];
}
