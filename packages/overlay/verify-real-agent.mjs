// Checks the playground's real-model agent (playground/real-agent.js) against a
// local stand-in for the Anthropic API (eyes/fixtures/fake-anthropic.py):
// requests carry the model, effort and fallback settings, a good key edits and
// answers, and a rejected key becomes a plain message. The browser flow is
// covered by the eyes case playground-real-model.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRealAgent, MODEL } from './playground/real-agent.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 4627;
const log = join(await mkdtemp(join(tmpdir(), 'sidenote-fake-api-')), 'requests.jsonl');
const fake = spawn('python3', [join(here, '..', '..', 'eyes', 'fixtures', 'fake-anthropic.py'), String(PORT), log], {
  stdio: 'inherit',
});
const baseURL = `http://127.0.0.1:${PORT}`;

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const comment = { body: 'tighten this', thread: [] };
const args = { file: 'posts/editing.md', passage: 'So basically, a draft.', comment, post: '# Post\n\nSo basically, a draft.\n' };

try {
  for (let i = 0; i < 50; i++) {
    if (await fetch(baseURL).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const agent = createRealAgent({ apiKey: 'sk-ant-test-key', baseURL });
  check(agent.model === MODEL && MODEL === 'claude-opus-5-5', 'agent reports the model it uses');
  check((await agent.edit(args)) === 'EDITED BY FAKE CLAUDE.', 'a good key returns the rewritten passage');
  check((await agent.ask(args)).startsWith('FAKE CLAUDE ANSWER'), 'a good key returns an answer');

  const bad = createRealAgent({ apiKey: 'sk-ant-wrong', baseURL });
  const message = await bad.edit(args).then(() => 'no error', (err) => err.message);
  check(message.includes('API key was rejected'), `a rejected key is explained (${message})`);
  check(!message.includes('sk-ant-wrong'), 'the error message never echoes the key');

  const requests = (await readFile(log, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
  const good = requests.filter((r) => r.key_ok);
  check(good.length === 2, 'two requests carried the good key');
  check(
    good.every((r) => r.body.model === 'claude-opus-5-5' && r.body.output_config?.effort === 'low' && r.body.fallbacks === 'default'),
    'requests ask for claude-opus-5-5 at low effort with server-side fallbacks'
  );
  check(good.every((r) => r.beta === 'server-side-fallback-2026-07-01'), 'requests send the fallback beta header');
} finally {
  fake.kill();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nPASS: real-model agent edits, answers and explains a rejected key');
