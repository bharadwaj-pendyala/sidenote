import { execFile, spawn } from 'node:child_process';
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
