import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, readlink, rm, stat, symlink, writeFile } from 'node:fs/promises';
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
// Two content folders, as `sidenote init` writes for Astro (src/content + src/pages).
await writeFile(join(root, '.sidenote', 'config.json'), JSON.stringify({ agent: 'mock', contentDir: ['content', 'notes'] }));
const note = 'notes/todo.md';
await mkdir(join(root, 'notes'), { recursive: true });
await writeFile(join(root, note), 'Write the launch post.\n');
await mkdir(join(root, 'other'), { recursive: true });
await writeFile(join(root, 'other', 'readme.md'), 'Out of scope.\n');

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

  // A second content folder is in scope; a folder outside contentDir is not.
  const outside = await fetch(`${base}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: 'other/readme.md', startOffset: 0, endOffset: 13, body: 'x' }),
  });
  check(outside.status === 400, 'a file outside every content folder is refused');
  const n = await post('/comments', { file: note, startOffset: 0, endOffset: 22, body: 'louder' });
  check(n.status === 'open', 'a file in the second content folder is accepted');

  // Resolving another file must not undo the first file's accepted, uncommitted edit.
  await post(`/comments/${n.id}/resolve`);
  await waitFor(n.id, (c) => c.status === 'resolving' && c.diff);
  check((await readFile(join(root, note), 'utf8')).startsWith('WRITE THE LAUNCH POST.'), 'second file edited');
  check((await onDisk()).includes('RAG RETRIEVES DOCUMENTS'), 'first file keeps its edit after another file resolves');

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

// --- cleanup after an agent run puts the author's uncommitted work back exactly
{
  const { snapshotFiles, restoreFiles } = await import('./git.js');
  const dir = await mkdtemp(join(tmpdir(), 'sidenote-snap-'));
  const binary = Buffer.from([0xff, 0xfe, 0x00, 0x80, 0x41]); // not valid UTF-8
  await writeFile(join(dir, 'edited.md'), 'mine\n');
  await writeFile(join(dir, 'reset.md'), 'also mine\n');
  await writeFile(join(dir, 'deleted.md'), 'keep me\n');
  await writeFile(join(dir, 'blob.bin'), binary);
  await writeFile(join(dir, 'run.sh'), '#!/bin/sh\necho hi\n');
  await chmod(join(dir, 'run.sh'), 0o755);
  await symlink('edited.md', join(dir, 'link.md'));
  const snap = await snapshotFiles(dir, ['edited.md', 'reset.md', 'deleted.md', 'blob.bin', 'absent.md', 'run.sh', 'link.md']);
  // What a stray agent might do: edit, reset to the committed text, delete, create.
  await writeFile(join(dir, 'edited.md'), 'agent\n');
  await writeFile(join(dir, 'reset.md'), 'committed\n');
  await rm(join(dir, 'deleted.md'));
  await writeFile(join(dir, 'blob.bin'), Buffer.from('agent'));
  await writeFile(join(dir, 'absent.md'), 'new\n');
  await rm(join(dir, 'run.sh'));
  await rm(join(dir, 'link.md'));
  const restored = await restoreFiles(dir, snap);
  check(restored.length === 7, 'restore reports every file it put back');
  check(((await stat(join(dir, 'run.sh'))).mode & 0o777) === 0o755, 'a deleted executable comes back executable');
  check((await readlink(join(dir, 'link.md'))) === 'edited.md', 'a deleted symlink comes back as the same symlink');
  check((await readFile(join(dir, 'edited.md'), 'utf8')) === 'mine\n', 'an edited dirty file is restored');
  check((await readFile(join(dir, 'reset.md'), 'utf8')) === 'also mine\n', 'a reset dirty file is restored');
  check((await readFile(join(dir, 'deleted.md'), 'utf8')) === 'keep me\n', 'a deleted dirty file is restored');
  check(binary.equals(await readFile(join(dir, 'blob.bin'))), 'a non-UTF-8 file is restored byte for byte');
  check(!(await readFile(join(dir, 'absent.md')).then(() => true, () => false)), 'a file that did not exist is removed again');
  check((await restoreFiles(dir, snap)).length === 0, 'restoring an unchanged tree touches nothing');
  await mkdir(join(dir, 'locked'));
  await writeFile(join(dir, 'locked', 'x.md'), 'x');
  await chmod(join(dir, 'locked'), 0o000);
  const unreadable = await snapshotFiles(dir, ['locked/x.md']).then(() => 'read', (e) => e.message);
  await chmod(join(dir, 'locked'), 0o755);
  // root reads through 0o000; elsewhere the snapshot must refuse, not record "absent"
  check(process.getuid?.() === 0 || unreadable.startsWith('cannot snapshot'), 'an unreadable dirty file stops the run instead of counting as absent');
}

// --- an explicit empty contentDir allows nothing, not the whole project
{
  const dir = await mkdtemp(join(tmpdir(), 'sidenote-empty-'));
  await mkdir(join(dir, '.sidenote'), { recursive: true });
  await writeFile(join(dir, '.sidenote', 'config.json'), JSON.stringify({ agent: 'mock', contentDir: [] }));
  await writeFile(join(dir, 'post.md'), 'Hello.\n');
  const port = PORT + 1;
  const p2 = spawn('node', [server], { env: { ...process.env, SIDENOTE_PORT: String(port), SIDENOTE_ROOT: dir }, stdio: 'ignore' });
  try {
    let res;
    for (let i = 0; i < 40 && !res; i++) {
      res = await fetch(`http://localhost:${port}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: 'post.md', startOffset: 0, endOffset: 6, body: 'x' }),
      }).catch(() => null);
      if (!res) await new Promise((r) => setTimeout(r, 50));
    }
    check(res?.status === 400, 'contentDir: [] refuses every file');
  } finally {
    p2.kill();
  }
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nPASS: resolve -> diff -> reject/revert -> resolve -> accept');
