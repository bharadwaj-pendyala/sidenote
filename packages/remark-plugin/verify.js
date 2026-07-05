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
