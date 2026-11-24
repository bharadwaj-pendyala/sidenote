import { execFile, spawn } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
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

// Exact state of each file — bytes, permissions, or a symlink's target; null
// when it does not exist — so work the author had not committed can be put back
// as it was after an agent run. Only a missing file counts as absent: any other
// read error throws, so the caller stops before the agent runs.
export async function snapshotFiles(projectRoot, files) {
  const snapshot = new Map();
  for (const file of files) {
    const abs = resolve(projectRoot, file);
    let info;
    try {
      info = await lstat(abs);
    } catch (err) {
      if (err.code === 'ENOENT') {
        snapshot.set(file, null);
        continue;
      }
      throw new Error(`cannot snapshot ${file} before the agent runs: ${err.message}`);
    }
    snapshot.set(
      file,
      info.isSymbolicLink()
        ? { link: await readlink(abs) }
        : { bytes: await readFile(abs), mode: info.mode & 0o7777 }
    );
  }
  return snapshot;
}

const sameState = (a, b) =>
  a === null || b === null
    ? a === b
    : a.link !== undefined || b.link !== undefined
      ? a.link === b.link
      : a.mode === b.mode && a.bytes.equals(b.bytes);

// Put every snapshotted file back as it was: rewritten if the agent changed,
// reset or deleted it, removed if it did not exist before. Returns the files
// it had to restore.
export async function restoreFiles(projectRoot, snapshot) {
  const restored = [];
  for (const [file, before] of snapshot) {
    const abs = resolve(projectRoot, file);
    // A file the agent left unreadable compares as changed and is restored.
    const now = await snapshotFiles(projectRoot, [file]).then((m) => m.get(file), () => undefined);
    if (now !== undefined && sameState(before, now)) continue;
    const regularToRegular = before?.bytes && now !== null && now?.link === undefined;
    if (regularToRegular) {
      // Same type: write in place, which keeps the inode (and any hard links).
      await chmod(abs, before.mode | 0o200).catch(() => {});
      await writeFile(abs, before.bytes);
      await chmod(abs, before.mode);
    } else {
      await rm(abs, { force: true });
      if (before !== null) {
        await mkdir(dirname(abs), { recursive: true });
        if (before.link !== undefined) {
          await symlink(before.link, abs);
        } else {
          await writeFile(abs, before.bytes);
          await chmod(abs, before.mode);
        }
      }
    }
    restored.push(file);
  }
  return restored;
}
