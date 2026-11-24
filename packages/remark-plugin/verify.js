import { remark } from 'remark';
import remarkHtml from 'remark-html';
import sidenoteOffsets from './index.js';

const source = `# RAG explained

RAG retrieves documents and stuff to ground the model.

The attention mechanism lets tokens look at each other.

- first point
- second point
`;

const html = String(
  await remark()
    .use(sidenoteOffsets, { file: 'content/posts/rag.md' })
    .use(remarkHtml, { sanitize: false })
    .process(source)
);

const stamped = [...html.matchAll(/data-sn-start="(\d+)"\s+data-sn-end="(\d+)"/g)];

if (stamped.length === 0) {
  console.error('FAIL: no data-sn-* attributes made it into the HTML');
  console.error(html);
  process.exit(1);
}

let failures = 0;
for (const [, start, end] of stamped) {
  const slice = source.slice(Number(start), Number(end));
  const ok = slice.trim().length > 0;
  console.log(`[${start}-${end}] ${ok ? 'OK' : 'EMPTY'}  ${JSON.stringify(slice.slice(0, 48))}`);
  if (!ok) failures++;
}

const firstPara = source.indexOf('RAG retrieves');
const paraMatch = stamped.find(([, s]) => Number(s) === firstPara);
if (!paraMatch) {
  console.error(`FAIL: first paragraph offset ${firstPara} was not stamped`);
  failures++;
} else {
  const slice = source.slice(Number(paraMatch[1]), Number(paraMatch[2]));
  if (slice !== 'RAG retrieves documents and stuff to ground the model.') {
    console.error(`FAIL: paragraph slice did not round-trip: ${JSON.stringify(slice)}`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log(`\nPASS: ${stamped.length} blocks stamped, offsets round-trip to source`);

// --- file path from the vfile (Astro / Docusaurus / Next MDX configure remark once)
import { VFile } from 'vfile';
import { join } from 'node:path';

const fromVfile = String(
  await remark()
    .use(sidenoteOffsets, { root: '/site' })
    .use(remarkHtml, { sanitize: false })
    .process(new VFile({ path: join('/site', 'src', 'content', 'blog', 'rag.md'), value: source }))
);
if (!fromVfile.includes('data-sn-file="src/content/blog/rag.md"')) {
  console.error('FAIL: vfile path was not used (or not made relative to root)');
  console.error(fromVfile);
  process.exit(1);
}
console.log('PASS: file comes from the vfile path, relative to root');

const noPath = String(await remark().use(sidenoteOffsets).use(remarkHtml).process(source));
if (noPath.includes('data-sn-')) {
  console.error('FAIL: stamped blocks with no file to point at');
  process.exit(1);
}
console.log('PASS: no file and no vfile path leaves the HTML unchanged');

// --- frontmatter stripped before parsing (Astro content collections, Docusaurus)
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'sn-'));
const body = 'A paragraph after frontmatter.\n';
const onDisk = `---\ntitle: Hi\n---\n\n${body}`;
writeFileSync(join(dir, 'post.md'), onDisk);
const stripped = String(
  await remark()
    .use(sidenoteOffsets, { root: dir })
    .use(remarkHtml, { sanitize: false })
    .process(new VFile({ path: join(dir, 'post.md'), value: body }))
);
const [, s0, e0] = stripped.match(/data-sn-start="(\d+)" data-sn-end="(\d+)"/) || [];
if (onDisk.slice(Number(s0), Number(e0)) !== 'A paragraph after frontmatter.') {
  console.error(`FAIL: offsets ignore stripped frontmatter: ${s0}-${e0}`);
  process.exit(1);
}
console.log('PASS: offsets point into the file on disk when frontmatter was stripped');
