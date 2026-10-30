#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);
const flag = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};

const COMMANDS = ['init', 'dev'];
const AGENTS = ['claude', 'codex'];
const USAGE =
  'usage: sidenote <init|dev> [--agent claude|codex] [--content content]\n' +
  '                [--port 4517] [--ask-model haiku] [--resolve-model opus]';

const fail = (message) => {
  console.error(`sidenote: ${message}`);
  process.exit(2);
};

// One edit away is close enough to be a typo: 'deev' -> 'dev', 'inti' -> 'init'.
const closeTo = (word, options) =>
  options.find((option) => {
    const [a, b] = [word, option];
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] !== b[j - 1]));
    return d[a.length][b.length] <= 1;
  });

if (cmd === 'init') {
  const agent = flag('agent', 'claude');
  if (!AGENTS.includes(agent) && agent !== 'mock') {
    fail(`unknown agent '${agent}'; use ${AGENTS.join(' or ')}`);
  }
  const port = flag('port', '4517');
  const contentDir = flag('content', 'content');
  const config = { agent, contentDir, port: Number(port) };
  const askModel = flag('ask-model');
  const resolveModel = flag('resolve-model');
  if (askModel) config.askModel = askModel;
  if (resolveModel) config.resolveModel = resolveModel;
  await mkdir(join(process.cwd(), '.sidenote'), { recursive: true });
  await writeFile(
    join(process.cwd(), '.sidenote', 'config.json'),
    JSON.stringify(config, null, 2) + '\n'
  );
  console.log(`
sidenote configured (agent: ${agent}).

Two one-time wiring steps in your site:

1) Stamp source offsets where you render markdown:

     import sidenoteOffsets from 'remark-sidenote';
     ...
     .use(sidenoteOffsets, { file: relativePathToThisMarkdownFile })

2) Load the overlay in dev only (e.g. in your layout):

     {process.env.NODE_ENV === 'development' && (
       <script src="http://localhost:${port}/overlay.js" defer />
     )}

Then run:  sidenote dev
`);
} else if (cmd === 'dev') {
  const port = flag('port', '4517');
  const daemon = join(here, '..', 'packages', 'daemon', 'server.js');
  spawn('node', [daemon], {
    env: { ...process.env, SIDENOTE_PORT: port, SIDENOTE_ROOT: process.cwd() },
    stdio: 'inherit',
  });
} else if (cmd === undefined || ['help', '--help', '-h'].includes(cmd)) {
  console.log(USAGE);
} else {
  const guess = closeTo(cmd, COMMANDS);
  console.error(USAGE);
  fail(`unknown command '${cmd}'` + (guess ? `; did you mean '${guess}'?` : ''));
}
