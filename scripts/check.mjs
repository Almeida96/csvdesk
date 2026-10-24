import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

for (const folder of ['src', 'scripts', 'test']) {
  for (const file of await readdir(folder)) if (/\.m?js$/.test(file)) execFileSync(process.execPath, ['--check', `${folder}/${file}`], { stdio: 'inherit' });
}
const html = await readFile('index.html', 'utf8');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'HTML IDs must be unique');
const app = await readFile('src/app.js', 'utf8');
for (const [, id] of app.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), `Missing HTML element: ${id}`);
console.log('JavaScript syntax and UI references checked.');
