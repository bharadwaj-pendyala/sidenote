import { execFile, spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function diffFile(projectRoot, file) {
  const { stdout } = await run('git', ['diff', '--', file], { cwd: projectRoot });
  return stdout;
}

export async function changedFiles(projectRoot) {
  const { stdout } = await run('git', ['diff', '--name-only'], { cwd: projectRoot });
  return stdout.split('\n').filter(Boolean);
}

export async function revertFile(projectRoot, file) {
  await run('git', ['checkout', '--', file], { cwd: projectRoot });
}

// Reverse-apply a captured diff so one comment's edit is undone without
// touching unrelated changes elsewhere in the same file.
export function revertPatch(projectRoot, diff) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('git', ['apply', '-R', '--whitespace=nowarn'], { cwd: projectRoot });
    let err = '';
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(err.trim() || `git apply -R exited ${code}`))
    );
    proc.stdin.end(diff);
  });
}

export async function isClean(projectRoot, file) {
  const { stdout } = await run('git', ['status', '--porcelain', '--', file], { cwd: projectRoot });
  return stdout.trim() === '';
}

// Exact bytes of each file (null when it does not exist), so work the author
// had not committed can be put back byte for byte after an agent run.
export async function snapshotFiles(projectRoot, files) {
  const snapshot = new Map();
  for (const file of files) {
    snapshot.set(file, await readFile(resolve(projectRoot, file)).catch(() => null));
  }
  return snapshot;
}

// Put every snapshotted file back as it was: rewritten if the agent changed,
// reset or deleted it, removed if it did not exist before. Returns the files
// it had to restore.
export async function restoreFiles(projectRoot, snapshot) {
  const restored = [];
  for (const [file, bytes] of snapshot) {
    const abs = resolve(projectRoot, file);
    const now = await readFile(abs).catch(() => null);
    if (bytes === null ? now === null : now !== null && bytes.equals(now)) continue;
    if (bytes === null) {
      await rm(abs, { force: true });
    } else {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, bytes);
    }
    restored.push(file);
  }
  return restored;
}
