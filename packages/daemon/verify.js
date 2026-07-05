import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await mkdtemp(join(tmpdir(), 'sidenote-'));
const PORT = 4599;
const base = `http://localhost:${PORT}`;
const server = fileURLToPath(new URL('./server.js', import.meta.url));

const proc = spawn('node', [server], {
  env: { ...process.env, SIDENOTE_PORT: String(PORT), SIDENOTE_ROOT: root },
  stdio: 'inherit',
});

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('daemon did not start');
}

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

try {
  await waitForHealth();

  const empty = await (await fetch(`${base}/comments`)).json();
  check(Array.isArray(empty) && empty.length === 0, 'starts with no comments');

  const created = await (
    await fetch(`${base}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file: 'content/posts/rag.md',
        startOffset: 17,
        endOffset: 71,
        quotedText: 'RAG retrieves documents and stuff to ground the model.',
        body: 'too vague, name the retriever',
      }),
    })
  ).json();
  check(created.id?.startsWith('cmt_'), 'create returns a cmt_ id');
  check(created.status === 'open', 'new comment is open');

  const bad = await fetch(`${base}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: 'x.md', startOffset: 5, endOffset: 2, body: 'bad' }),
  });
  check(bad.status === 400, 'rejects endOffset <= startOffset');

  const patched = await (
    await fetch(`${base}/comments/${created.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'resolved' }),
    })
  ).json();
  check(patched.status === 'resolved', 'patch updates status');

  const persisted = JSON.parse(await readFile(join(root, '.sidenote', 'comments.json'), 'utf8'));
  check(persisted.length === 1 && persisted[0].status === 'resolved', 'persisted to disk');

  const del = await fetch(`${base}/comments/${created.id}`, { method: 'DELETE' });
  check(del.status === 204, 'delete returns 204');

  const afterDelete = await (await fetch(`${base}/comments`)).json();
  check(afterDelete.length === 0, 'comment removed');
} finally {
  proc.kill();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nPASS: daemon CRUD works end-to-end');
