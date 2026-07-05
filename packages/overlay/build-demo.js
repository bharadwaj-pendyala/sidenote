import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import sidenoteOffsets from '../remark-plugin/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, 'demo', 'sample.md'), 'utf8');
const overlay = await readFile(join(here, 'overlay.js'), 'utf8');
const port = process.env.SIDENOTE_PORT || 4517;

const content = String(
  await remark()
    .use(sidenoteOffsets, { file: 'demo/sample.md' })
    .use(remarkHtml, { sanitize: false })
    .process(source)
);

const html = `<!doctype html>
<meta charset="utf-8">
<title>sidenote demo</title>
<style> body { max-width: 640px; margin: 40px; font: 16px/1.6 Georgia, serif; } </style>
<article>${content}</article>
<script>window.SIDENOTE_PORT = ${port};</script>
<script>${overlay}</script>
`;

await writeFile(join(here, 'demo', 'index.html'), html);
console.log('wrote demo/index.html');
