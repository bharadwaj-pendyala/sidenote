import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export async function diffFile(projectRoot, file) {
  const { stdout } = await run('git', ['diff', '--', file], { cwd: projectRoot });
  return stdout;
}

export async function revertFile(projectRoot, file) {
  await run('git', ['checkout', '--', file], { cwd: projectRoot });
}

export async function isClean(projectRoot, file) {
  const { stdout } = await run('git', ['status', '--porcelain', '--', file], { cwd: projectRoot });
  return stdout.trim() === '';
}
