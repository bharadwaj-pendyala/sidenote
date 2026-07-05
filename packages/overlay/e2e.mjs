import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const playwrightEntry =
  process.env.PLAYWRIGHT_PATH ||
  '/Users/bharad/Documents/Github/bharad-portfolio/node_modules/playwright/index.js';
const pw = await import(playwrightEntry);
const chromium = pw.chromium ?? pw.default?.chromium;

const here = dirname(fileURLToPath(import.meta.url));
const DAEMON_PORT = 4611;
const WEB_PORT = 4612;
const root = await mkdtemp(join(tmpdir(), 'sidenote-e2e-'));

spawnSync('node', ['build-demo.js'], {
  cwd: here,
  env: { ...process.env, SIDENOTE_PORT: String(DAEMON_PORT) },
  stdio: 'inherit',
});

const daemon = spawn('node', ['../daemon/server.js'], {
  cwd: here,
  env: { ...process.env, SIDENOTE_PORT: String(DAEMON_PORT), SIDENOTE_ROOT: root },
  stdio: 'inherit',
});

const web = createServer(async (req, res) => {
  try {
    const body = await readFile(join(here, 'demo', 'index.html'));
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
web.listen(WEB_PORT);

const daemonComments = () =>
  fetch(`http://localhost:${DAEMON_PORT}/comments`).then((r) => r.json());

async function waitForDaemon() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${DAEMON_PORT}/health`)).ok) return;
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

const browser = await chromium.launch();
try {
  await waitForDaemon();
  const page = await browser.newPage();
  await page.goto(`http://localhost:${WEB_PORT}/index.html`);

  await page.waitForSelector('#sn-rail');
  check((await page.locator('.sn-card').count()) === 0, 'rail starts empty');

  await page.locator('article p').first().click({ clickCount: 3 });
  await page.waitForSelector('#sn-add', { state: 'visible' });
  await page.locator('#sn-add').click();
  await page.waitForSelector('#sn-pop textarea', { state: 'visible' });
  await page.locator('#sn-pop textarea').fill('too vague, name the retriever');
  await page.locator('#sn-pop [data-sn-save]').click();

  await page.waitForSelector('.sn-card');
  check((await page.locator('.sn-card').count()) === 1, 'card appears in rail after save');

  const stored = await daemonComments();
  check(stored.length === 1, 'comment persisted to daemon');
  check(stored[0]?.file === 'demo/sample.md', 'comment carries source file');
  check(Number.isInteger(stored[0]?.startOffset), 'comment carries byte offset');

  await page.reload();
  await page.waitForSelector('.sn-card');
  check((await page.locator('.sn-card').count()) === 1, 'comment survives reload');
  check((await page.locator('.sn-anchored').count()) === 1, 'block re-anchors after reload');

  await page.locator('.sn-card [data-del]').click();
  await page.waitForFunction(() => document.querySelectorAll('.sn-card').length === 0);
  check((await daemonComments()).length === 0, 'delete removes comment');
} finally {
  await browser.close();
  daemon.kill();
  web.close();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log('\nPASS: overlay select -> comment -> persist -> reanchor -> delete');
