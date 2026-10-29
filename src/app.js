import { LIMITS, serializeCSV } from './csv.js';
import { analyze, cleanTable, deduplicate, viewRows, exportRows } from './table.js';

const $ = id => document.getElementById(id);
const delimiterValue = value => value === 'tab' ? '\t' : value;
const delimiterName = value => ({ ',': 'Comma', ';': 'Semicolon', '\t': 'Tab', '|': 'Pipe' })[value];
const number = value => value.toLocaleString('en-US');
const countLabel = (count, noun) => `${number(count)} ${noun}${count === 1 ? '' : 's'}`;
const pageSize = 50;
let table = null, source = null, statistics = null, history = [], indices = [];
let page = 0, sortColumn = -1, sortDirection = 'asc', busy = false, importedDelimiter = ',';
let loadId = 0, activeWorker = null, searchTimer;

function message(text) { $('status').textContent = text; }
function error(text = '') { $('error').textContent = text; $('error').hidden = !text; }
function columnName(index) { return table.headers[index] || `Column ${index + 1}`; }

function controls() {
  for (const id of ['open', 'sample', 'delimiter', 'encoding', 'has-header']) $(id).disabled = busy;
  for (const id of ['export', 'search', 'reimport']) $(id).disabled = busy || !table;
  $('undo').disabled = busy || !history.length;
  $('trim').disabled = busy || !statistics?.spaces;
  $('empty').disabled = busy || !statistics?.empty;
  $('duplicates').disabled = busy || !table || table.rows.length < 2;
  $('reset-view').disabled = busy || (!($('search').value) && sortColumn === -1);
  $('previous').disabled = busy || page === 0;
  $('next').disabled = busy || (page + 1) * pageSize >= indices.length;
  for (const button of $('table-head').querySelectorAll('button')) button.disabled = busy;
  document.querySelector('main').setAttribute('aria-busy', String(busy));
}

function renderHeader() {
  const row = document.createElement('tr');
  const position = document.createElement('th');
  position.textContent = '#'; position.className = 'row-number'; position.scope = 'col'; row.append(position);
  table.headers.forEach((_, index) => {
    const th = document.createElement('th'); th.scope = 'col';
    th.setAttribute('aria-sort', sortColumn === index ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none');
    const button = document.createElement('button');
    button.setAttribute('aria-label', `Sort by ${columnName(index)}, column ${index + 1}`);
    button.append(document.createTextNode(columnName(index)));
    const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = sortColumn === index ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'; button.append(arrow);
    button.addEventListener('click', () => {
      sortDirection = sortColumn === index && sortDirection === 'asc' ? 'desc' : 'asc';
      sortColumn = index; page = 0; renderView();
      message(`Sorted by ${columnName(index)}, ${sortDirection === 'asc' ? 'ascending' : 'descending'}.`);
      $('table-head').querySelectorAll('button')[index].focus();
    });
    th.append(button); row.append(th);
  });
  $('table-head').replaceChildren(row);
}

function renderView() {
  if (!table) { controls(); return; }
  indices = viewRows(table, $('search').value, sortColumn, sortDirection);
  page = Math.min(page, Math.max(0, Math.ceil(indices.length / pageSize) - 1));
  renderHeader();
  const fragment = document.createDocumentFragment();
  for (const index of indices.slice(page * pageSize, (page + 1) * pageSize)) {
    const row = document.createElement('tr');
    const position = document.createElement('th'); position.scope = 'row'; position.className = 'row-number'; position.textContent = String(index + 1); row.append(position);
    for (const value of table.rows[index]) {
      const cell = document.createElement('td');
      cell.textContent = value === '' ? '—' : value;
      cell.title = value === '' ? 'Empty cell' : value;
      if (value === '') { cell.className = 'blank-cell'; cell.setAttribute('aria-label', 'Empty cell'); }
      else if (value !== value.trim()) cell.className = 'padded-cell';
      row.append(cell);
    }
    fragment.append(row);
  }
  $('table-body').replaceChildren(fragment);
  $('empty-view').hidden = indices.length > 0;
  if (!indices.length) {
    $('empty-view').querySelector('strong').textContent = table.rows.length ? 'No matching rows' : 'No data rows';
    $('empty-view').querySelector('p').textContent = table.rows.length ? 'Try another search or reset the view.' : 'The file contains column names only, or all rows were removed.';
  }
  $('page-info').textContent = indices.length
    ? `${number(page * pageSize + 1)}–${number(Math.min((page + 1) * pageSize, indices.length))} of ${number(indices.length)}${indices.length !== table.rows.length ? ` matching / ${number(table.rows.length)} total` : ''} rows`
    : `0 of ${number(table.rows.length)} rows`;
  $('page-number').textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(indices.length / pageSize))}`;
  controls();
}

function renderTable() {
  statistics = analyze(table);
  $('row-count').textContent = number(table.rows.length);
  $('column-count').textContent = number(table.headers.length);
  $('blank-count').textContent = number(statistics.blank);
  $('space-count').textContent = number(statistics.spaces);
  $('empty-count').textContent = number(statistics.empty);
  $('duplicate-count').textContent = number(statistics.duplicates);
  $('import-note').hidden = !table.uneven;
  $('import-note').textContent = `${number(table.uneven)} records had fewer fields. Missing cells are shown as empty; no fields were removed.`;
  renderView();
}

async function openSource(candidate) {
  if (candidate.file.size > LIMITS.bytes) { error('This file exceeds the 10 MiB limit. The current table was kept.'); return; }
  const id = ++loadId;
  clearTimeout(searchTimer);
  activeWorker?.terminate();
  busy = true; controls(); error(); message(`Reading ${candidate.file.name}…`);
  const options = { encoding: $('encoding').value, delimiter: delimiterValue($('delimiter').value), hasHeader: $('has-header').checked };
  try {
    const buffer = await candidate.file.arrayBuffer();
    if (id !== loadId) return;
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./import-worker.js', import.meta.url), { type: 'module' });
      activeWorker = worker;
      const finish = callback => { clearTimeout(timeout); worker.terminate(); if (activeWorker === worker) activeWorker = null; callback(); };
      const timeout = setTimeout(() => finish(() => reject(new Error('Import took too long. Try a smaller file.'))), 15000);
      worker.onmessage = ({ data }) => finish(() => data.error ? reject(new Error(data.error)) : resolve(data));
      worker.onerror = () => finish(() => reject(new Error('The import worker could not start. Reload the page and try again.')));
      worker.postMessage({ buffer, ...options }, [buffer]);
    });
    if (id !== loadId) return;
    source = candidate; table = result.table; importedDelimiter = result.delimiter;
    history = []; page = 0; sortColumn = -1; $('search').value = '';
    $('filename').textContent = candidate.file.name;
    $('sample-label').hidden = !candidate.sample;
    $('file-detail').textContent = `${number(candidate.file.size)} bytes · ${options.encoding === 'utf-8' ? 'UTF-8' : 'Windows-1252'} · ${table.hasHeader ? 'Header row included' : 'No header row'}`;
    $('detected').textContent = `${delimiterName(importedDelimiter)} separated`;
    renderTable();
    message(candidate.sample ? 'Sample loaded. Highlighted cells contain spaces at the edges.' : `Opened ${candidate.file.name}. ${countLabel(table.rows.length, 'data row')}.`);
  } catch (cause) {
    if (id !== loadId) return;
    error(`${cause.message} ${table ? 'The current table was kept.' : ''}`.trim());
    message('Import failed. Check the file and import settings, then open it again.');
  } finally { if (id === loadId) { busy = false; controls(); } }
}

async function loadSample() {
  if (busy) return;
  busy = true; controls();
  try {
    const response = await fetch(new URL('../sample.csv', import.meta.url));
    if (!response.ok) throw new Error('Sample file could not be loaded.');
    const blob = await response.blob();
    $('delimiter').value = 'auto'; $('encoding').value = 'utf-8'; $('has-header').checked = true;
    await openSource({ file: new File([blob], 'inventory.csv', { type: 'text/csv' }), sample: true });
  } catch (cause) { error(cause.message); busy = false; controls(); }
}

$('open').addEventListener('click', () => $('file-input').click());
$('file-input').addEventListener('change', () => {
  const file = $('file-input').files[0]; $('file-input').value = '';
  if (file) openSource({ file, sample: false });
});
$('sample').addEventListener('click', loadSample);
$('reimport').addEventListener('click', () => source && openSource(source));
for (const eventName of ['dragenter', 'dragover']) {
  document.addEventListener(eventName, event => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault(); document.body.classList.add('drag-over');
  });
}
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.body.classList.remove('drag-over'); });
document.addEventListener('drop', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault(); document.body.classList.remove('drag-over');
  if (busy || $('export-dialog').open || $('dedupe-dialog').open) return;
  if (event.dataTransfer.files.length !== 1) { error('Drop one CSV file at a time.'); return; }
  openSource({ file: event.dataTransfer.files[0], sample: false });
});
for (const operation of ['trim', 'empty']) {
  $(operation).addEventListener('click', () => {
    const result = cleanTable(table, operation);
    if (!result.changed) return;
    history.push(table); if (history.length > 10) history.shift();
    table = result.table; page = 0; renderTable(); error();
    const action = operation === 'trim' ? `Trimmed ${countLabel(result.changed, 'cell')}.` : `Removed ${countLabel(result.changed, operation === 'empty' ? 'empty row' : 'duplicate row')}.`;
    message(`${action} Applied to all rows. Undo is available.`);
  });
}
$('undo').addEventListener('click', () => {
  if (!history.length) return;
  table = history.pop(); renderTable(); error(); message('Last cleanup step undone.');
});

function duplicatePreview() {
  const columns = [...$('dedupe-columns').querySelectorAll('input:checked')].map(input => Number(input.value));
  return deduplicate(table, columns, { keep: $('dedupe-keep').value, trim: $('dedupe-trim').checked, ignoreCase: $('dedupe-case').checked, skipBlank: $('dedupe-blank').checked });
}
function updateDuplicatePreview() {
  try {
    const result = duplicatePreview();
    $('dedupe-summary').textContent = `${countLabel(result.changed, 'row')} will be removed; ${countLabel(result.table.rows.length, 'row')} will remain. Matches use all rows in their original order.`;
    $('dedupe-apply').disabled = !result.changed;
  } catch (cause) { $('dedupe-summary').textContent = cause.message; $('dedupe-apply').disabled = true; }
}
$('duplicates').addEventListener('click', () => {
  $('dedupe-columns').replaceChildren(...table.headers.map((_, index) => {
    const label = document.createElement('label'); label.className = 'check';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = String(index); checkbox.checked = true;
    label.append(checkbox, document.createTextNode(`${columnName(index)} (${index + 1})`)); return label;
  }));
  updateDuplicatePreview(); $('dedupe-dialog').showModal();
});
$('dedupe-dialog').addEventListener('change', updateDuplicatePreview);
$('dedupe-close').addEventListener('click', () => $('dedupe-dialog').close());
$('dedupe-apply').addEventListener('click', () => {
  const result = duplicatePreview();
  if (!result.changed) return;
  history.push(table); if (history.length > 10) history.shift();
  table = result.table; page = 0; renderTable(); error(); $('dedupe-dialog').close();
  message(`Removed ${countLabel(result.changed, 'duplicate row')} using selected columns. Undo is available.`);
});
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page = 0; renderView(); message(`${countLabel(indices.length, 'matching row')}.`); }, 100);
});
$('reset-view').addEventListener('click', () => { clearTimeout(searchTimer); $('search').value = ''; sortColumn = -1; page = 0; renderView(); message('Search and sorting cleared.'); });
for (const [id, increment] of [['previous', -1], ['next', 1]]) {
  $(id).addEventListener('click', () => { page += increment; renderView(); $('table-scroll').scrollTop = 0; message($('page-info').textContent); });
}
$('export').addEventListener('click', () => {
  clearTimeout(searchTimer); renderView();
  $('export-name').value = source.file.name.replace(/\.[^.]+$/, '') + '-cleaned.csv';
  $('export-delimiter').value = importedDelimiter === '\t' ? 'tab' : importedDelimiter;
  $('export-scope').value = $('search').value || sortColumn >= 0 ? 'view' : 'all';
  $('export-header').checked = table.hasHeader;
  $('export-error').hidden = true;
  $('export-columns').replaceChildren(...table.headers.map((_, index) => {
    const label = document.createElement('label'); label.className = 'check';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.value = String(index);
    label.append(checkbox, document.createTextNode(columnName(index))); return label;
  }));
  updateExportSummary(); $('export-dialog').showModal();
});
function updateExportSummary() {
  const count = $('export-scope').value === 'view' ? indices.length : table.rows.length;
  $('export-summary').textContent = `${countLabel(count, 'data row')} selected. Column order follows the original file.`;
}
$('export-scope').addEventListener('change', updateExportSummary);
$('close-export').addEventListener('click', () => $('export-dialog').close());
$('download').addEventListener('click', () => {
  try {
    const columns = [...$('export-columns').querySelectorAll('input:checked')].map(input => Number(input.value));
    const selectedRows = $('export-scope').value === 'view' ? indices : table.rows.map((_, index) => index);
    const rows = exportRows(table, selectedRows, columns, $('export-header').checked);
    const csv = serializeCSV(rows, { delimiter: delimiterValue($('export-delimiter').value), bom: $('export-bom').checked, escapeFormulas: $('escape-formulas').checked });
    let name = $('export-name').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '-');
    if (!name) throw new Error('Enter a file name.');
    if (!/\.csv$/i.test(name)) name += '.csv';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = name; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('export-dialog').close(); message(`Exported ${countLabel(selectedRows.length, 'row')} to ${name}.`);
  } catch (cause) { $('export-error').textContent = cause.message; $('export-error').hidden = false; }
});

loadSample();
