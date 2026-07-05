import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = await mkdtemp(join(tmpdir(), 'sidenote-resolve-'));
const PORT = 4623;
const base = `http://localhost:${PORT}`;
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

const proc = spawn('node', ['server.js'], {
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

  const resolved = await post(`/comments/${comment.id}/resolve`);
  check(resolved.diff.includes('+RAG RETRIEVES DOCUMENTS'), 'resolve edits file and returns diff');
  check((await onDisk()).includes('RAG RETRIEVES DOCUMENTS'), 'edit landed on disk');
  check(resolved.comment.status === 'resolving', 'status is resolving after resolve');

  const rejected = await post(`/comments/${comment.id}/reject`);
  check(rejected.status === 'open', 'reject reopens comment');
  check((await onDisk()) === original, 'reject reverts file to original');

  await post(`/comments/${comment.id}/resolve`);
  const accepted = await post(`/comments/${comment.id}/accept`);
  check(accepted.status === 'resolved', 'accept marks resolved');
  check((await onDisk()).includes('RAG RETRIEVES DOCUMENTS'), 'accept keeps the edit');
} finally {
  proc.kill();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nPASS: resolve -> diff -> reject/revert -> resolve -> accept');
