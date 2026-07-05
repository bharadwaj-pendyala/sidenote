import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

function buildPrompt(file, comments) {
  const items = comments
    .map(
      (c, i) =>
        `Comment ${i + 1} targets this passage in ${file}:\n"""\n${c.quotedText}\n"""\nInstruction: ${c.body}`
    )
    .join('\n\n');
  return (
    `You are copy-editing a markdown blog. Apply the review comments below by editing ` +
    `ONLY the referenced passages in ${file}. Preserve markdown structure. Change nothing else. ` +
    `Do not add explanations to the file.\n\n${items}`
  );
}

/** Deterministic, no-LLM adapter for tests: uppercases each targeted range. */
function mockAdapter() {
  return {
    async resolve(projectRoot, file, comments) {
      const path = join(projectRoot, file);
      let src = await readFile(path, 'utf8');
      for (const c of [...comments].sort((a, b) => b.startOffset - a.startOffset)) {
        const before = src.slice(0, c.startOffset);
        const target = src.slice(c.startOffset, c.endOffset);
        const after = src.slice(c.endOffset);
        src = before + target.toUpperCase() + after;
      }
      await writeFile(path, src);
    },
  };
}

function cliAdapter(cmd, argsFor) {
  return {
    async resolve(projectRoot, file, comments) {
      const prompt = buildPrompt(file, comments);
      await run(cmd, argsFor(prompt), { cwd: projectRoot, maxBuffer: 10 * 1024 * 1024 });
    },
  };
}

export function makeAdapter(name) {
  switch (name) {
    case 'mock':
      return mockAdapter();
    case 'claude':
      return cliAdapter('claude', (p) => ['-p', p, '--permission-mode', 'acceptEdits']);
    case 'codex':
      return cliAdapter('codex', (p) => [
        'exec',
        '--sandbox',
        'workspace-write',
        '--skip-git-repo-check',
        p,
      ]);
    default:
      throw new Error(`unknown agent: ${name}`);
  }
}
