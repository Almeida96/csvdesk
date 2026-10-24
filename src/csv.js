export const LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, rows: 50001, columns: 100, cells: 500000 });
export const DELIMITERS = [',', ';', '\t', '|'];

function checkDelimiter(delimiter) {
  if (!DELIMITERS.includes(delimiter)) throw new Error('Choose comma, semicolon, tab, or pipe as the separator.');
}

export function decodeFile(buffer, encoding = 'utf-8') {
  if (buffer.byteLength > LIMITS.bytes) throw new Error('This file exceeds the 10 MiB limit.');
  if (!['utf-8', 'windows-1252'].includes(encoding)) throw new Error('Unsupported encoding.');
  const bytes = new Uint8Array(buffer);
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) {
    throw new Error('This file uses UTF-16. Save it as UTF-8 CSV before opening it.');
  }
  try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('The file is not valid UTF-8. Try Windows-1252 in the import settings.'); }
}

export function detectDelimiter(text) {
  const counts = [];
  let row = [0, 0, 0, 0], quoted = false, content = false;
  for (let i = 0; i < text.length && counts.length < 30; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
      content = true;
    } else if (!quoted && (char === '\r' || char === '\n')) {
      if (content) counts.push(row);
      row = [0, 0, 0, 0]; content = false;
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (!quoted) {
      const index = DELIMITERS.indexOf(char);
      if (index !== -1) row[index]++;
      if (char.trim()) content = true;
      if (index !== -1) content = true;
    }
  }
  if (content && counts.length < 30) counts.push(row);
  let best = ',', bestScore = 0;
  for (let i = 0; i < DELIMITERS.length; i++) {
    const frequencies = new Map();
    for (const values of counts) if (values[i]) frequencies.set(values[i], (frequencies.get(values[i]) ?? 0) + 1);
    for (const [width, frequency] of frequencies) {
      const score = frequency / counts.length * 100 + Math.min(width, 99) / 100;
      if (score > bestScore) { best = DELIMITERS[i]; bestScore = score; }
    }
  }
  return best;
}

export function parseCSV(input, delimiter = ',', limits = LIMITS) {
  checkDelimiter(delimiter);
  if (typeof input !== 'string') throw new TypeError('CSV input must be text.');
  if (input.length > LIMITS.bytes) throw new Error('CSV text exceeds the 10 MiB character limit.');
  const text = input.replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new Error('The file contains null bytes. Check its encoding or choose a text CSV file.');
  if (!text.length) return [];
  const rows = [];
  let row = [], field = '', state = 'start', line = 1, cells = 0;
  const fail = message => { throw new Error(`${message} (line ${line}).`); };
  const endField = () => {
    row.push(field); field = ''; state = 'start'; cells++;
    if (row.length > limits.columns) fail(`More than ${limits.columns} columns`);
    if (cells > limits.cells) fail(`More than ${limits.cells.toLocaleString('en-US')} cells`);
  };
  const endRow = () => {
    endField(); rows.push(row); row = [];
    if (rows.length > limits.rows) fail('More than 50,000 data rows');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else state = 'closed';
      } else {
        field += char;
        if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) line++;
      }
    } else if (char === delimiter) endField();
    else if (char === '\r' || char === '\n') {
      endRow(); line++;
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"' && state === 'start') state = 'quoted';
    else if (char === '"') fail('Unexpected quote in an unquoted field');
    else if (state === 'closed') fail('Unexpected character after a closing quote');
    else { field += char; state = 'plain'; }
  }
  if (state === 'quoted') fail('Unclosed quoted field');
  if (row.length || field.length || state !== 'start' || !/[\r\n]$/.test(text)) endRow();
  return rows;
}

export function formulaLike(value) {
  return /^[\t\r\n]/.test(value) || /^[\s\uFEFF]*[=+\-@＝＋－＠]/u.test(value);
}

export function serializeCSV(rows, { delimiter = ',', bom = false, escapeFormulas = false } = {}) {
  checkDelimiter(delimiter);
  const quote = value => {
    if (typeof value !== 'string') throw new TypeError('CSV cells must be strings.');
    const escaped = escapeFormulas && formulaLike(value);
    const text = escaped ? `'${value}` : value;
    return escaped || text === '' || text.includes(delimiter) || /["\r\n]/.test(text)
      ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return (bom ? '\uFEFF' : '') + (rows.length ? rows.map(row => row.map(quote).join(delimiter)).join('\r\n') + '\r\n' : '');
}
