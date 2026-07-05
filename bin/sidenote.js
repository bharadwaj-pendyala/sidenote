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

if (cmd === 'init') {
  const agent = flag('agent', 'claude');
  const port = flag('port', '4517');
  await mkdir(join(process.cwd(), '.sidenote'), { recursive: true });
  await writeFile(
    join(process.cwd(), '.sidenote', 'config.json'),
    JSON.stringify({ agent }, null, 2) + '\n'
  );
  console.log(`
sidenote configured (agent: ${agent}).

Two one-time wiring steps in your site:

1) Stamp source offsets where you render markdown:

     import sidenoteOffsets from '@sidenote/remark-plugin';
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
} else {
  console.log('usage: sidenote <init|dev> [--agent claude|codex] [--port 4517]');
}
