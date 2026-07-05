import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await mkdtemp(join(tmpdir(), 'sidenote-resolve-'));
const PORT = 4623;
const base = `http://localhost:${PORT}`;
const server = fileURLToPath(new URL('./server.js', import.meta.url));
const file = 'content/post.md';
const original = '# Title\n\nRAG retrieves documents to ground the model.\n';

await mkdir(join(root, 'content'), { recursive: true });
await writeFile(join(root, file), original);
await mkdir(join(root, '.sidenote'), { recursive: true });
await writeFile(join(root, '.sidenote', 'config.json'), JSON.stringify({ agent: 'mock' }));

const git = (...args) => execFileSync('git', args, { cwd: root });
git('init', '-q');
git('config', 'user.email', 't@t.t');
git('config', 'user.name', 't');
git('add', '-A');
git('commit', '-qm', 'init');

const proc = spawn('node', [server], {
  env: { ...process.env, SIDENOTE_PORT: String(PORT), SIDENOTE_ROOT: root },
  stdio: 'inherit',
});

const post = (path, body) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

async function waitForHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`${base}/health`)).ok) return;
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
const onDisk = () => readFile(join(root, file), 'utf8');
const find = async (id) => (await (await fetch(`${base}/comments`)).json()).find((c) => c.id === id);
async function waitFor(id, pred) {
  for (let i = 0; i < 100; i++) {
    const c = await find(id);
    if (c && pred(c)) return c;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('timed out waiting for comment state');
}

try {
  await waitForHealth();

  const paraStart = original.indexOf('RAG');
  const paraEnd = paraStart + 'RAG retrieves documents to ground the model.'.length;
  const comment = await post('/comments', {
    file,
    startOffset: paraStart,
    endOffset: paraEnd,
    quotedText: 'RAG retrieves documents to ground the model.',
    body: 'shout it',
  });

  await post(`/comments/${comment.id}/resolve`);
  const resolved = await waitFor(comment.id, (c) => c.status === 'resolving' && c.diff);
  check(resolved.diff.includes('+RAG RETRIEVES DOCUMENTS'), 'resolve edits file and returns diff');
  check((await onDisk()).includes('RAG RETRIEVES DOCUMENTS'), 'edit landed on disk');

  const rejected = await post(`/comments/${comment.id}/reject`);
  check(rejected.status === 'open', 'reject reopens comment');
  check((await onDisk()) === original, 'reject reverts file to original');

  await post(`/comments/${comment.id}/resolve`);
  await waitFor(comment.id, (c) => c.status === 'resolving' && c.diff);
  const accepted = await post(`/comments/${comment.id}/accept`);
  check(accepted.status === 'resolved', 'accept marks resolved');
  check((await onDisk()).includes('RAG RETRIEVES DOCUMENTS'), 'accept keeps the edit');

  // Ask mode: agent answers in the thread and never edits the file.
  const titleStart = original.indexOf('Title');
  const q = await post('/comments', {
    file,
    startOffset: titleStart,
    endOffset: titleStart + 'Title'.length,
    body: 'what does this mean?',
  });
  const before = await onDisk();
  await post(`/comments/${q.id}/ask`);
  const asked = await waitFor(q.id, (c) => c.status === 'answered');
  check(asked.thread.at(-1)?.role === 'agent', 'ask appends an agent turn');
  check((await onDisk()) === before, 'ask leaves the file untouched');

  await post(`/comments/${q.id}/reply`, { text: 'in one line?' });
  const replied = await waitFor(q.id, (c) => c.thread.length >= 3);
  check(replied.thread.filter((t) => t.role === 'user').length === 1, 'reply records the question');
  check(replied.thread.at(-1)?.role === 'agent', 'reply gets a fresh agent answer');
} finally {
  proc.kill();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nPASS: resolve -> diff -> reject/revert -> resolve -> accept');
