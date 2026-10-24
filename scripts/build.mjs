import { mkdir, cp } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
for (const path of ['index.html', 'style.css', 'icon.svg', 'sample.csv', 'src']) await cp(path, `dist/${path}`, { recursive: true });
console.log('Built dist/');
