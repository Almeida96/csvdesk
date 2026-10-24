import { decodeFile, detectDelimiter, parseCSV } from './csv.js';
import { createTable } from './table.js';

self.onmessage = ({ data }) => {
  try {
    const text = decodeFile(data.buffer, data.encoding);
    const delimiter = data.delimiter === 'auto' ? detectDelimiter(text) : data.delimiter;
    self.postMessage({ table: createTable(parseCSV(text, delimiter), data.hasHeader), delimiter });
  } catch (error) { self.postMessage({ error: error.message }); }
};
