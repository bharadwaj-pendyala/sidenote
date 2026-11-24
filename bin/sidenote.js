#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { access, mkdir, writeFile } from 'node:fs/promises';
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

// Each framework wires remark and the overlay script in its own place. Frameworks
// that configure remark once pass the file on the vfile, so no per-file path.
const FRAMEWORKS = [
  {
    name: 'Astro',
    configs: ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'],
    contentDirs: ['src/content', 'src/pages'],
    guide: 'astro',
    steps: (config, overlay) => `1) Stamp source offsets in ${config}:

     import sidenote from 'remark-sidenote';

     export default defineConfig({
       markdown: { remarkPlugins: [sidenote] },
     });

2) Load the overlay in dev only, in your layout's <head>:

     {import.meta.env.DEV && (
       <script is:inline src="${overlay}" defer></script>
     )}`,
  },
  {
    name: 'Docusaurus',
    configs: ['docusaurus.config.js', 'docusaurus.config.mjs', 'docusaurus.config.ts'],
    contentDirs: ['docs', 'blog', 'src/pages'],
    guide: 'docusaurus',
    steps: (config, overlay) => `1) Stamp source offsets in ${config}, for docs and blog:

     import sidenote from 'remark-sidenote';

     presets: [['classic', {
       docs: { remarkPlugins: [sidenote] },
       blog: { remarkPlugins: [sidenote] },
     }]],

2) Load the overlay in dev only, also in ${config}:

     headTags: process.env.NODE_ENV === 'development'
       ? [{
           tagName: 'script',
           attributes: {
             src: '${overlay}',
             defer: 'true',
           },
         }]
       : [],`,
  },
  {
    name: 'Next.js',
    configs: ['next.config.mjs', 'next.config.js', 'next.config.ts'],
    contentDirs: ['content', 'app', 'pages', 'src/app', 'src/pages'],
    guide: 'nextjs',
    steps: (config, overlay) => `1) Stamp source offsets. With @next/mdx, in ${config}:

     const withMDX = createMDX({
       options: { remarkPlugins: [['remark-sidenote', {}]] },
     });

   If you call remark() yourself, pass the file instead:

     .use(sidenoteOffsets, { file: 'content/posts/my-post.md' })

2) Load the overlay in dev only (e.g. in app/layout.tsx):

     {process.env.NODE_ENV === 'development' && (
       <script src="${overlay}" defer />
     )}`,
  },
];

const exists = (path) => access(path).then(() => true, () => false);

async function detectFramework(root) {
  for (const fw of FRAMEWORKS) {
    for (const config of fw.configs) {
      if (await exists(join(root, config))) return { ...fw, config };
    }
  }
  return null;
}

// The daemon only edits markdown inside contentDir, so it must cover every
// folder the printed steps instrument: all of the framework's folders that
// exist, as a list when there are several.
async function pickContentDir(root, fw) {
  if (!fw) return 'content';
  const found = [];
  for (const dir of fw.contentDirs) {
    if (await exists(join(root, dir))) found.push(dir);
  }
  if (found.length === 0) return fw.contentDirs[0];
  return found.length === 1 ? found[0] : found;
}

const REPO = 'github.com/bharadwaj-pendyala/sidenote';

if (cmd === 'init') {
  const agent = flag('agent', 'claude');
  if (!AGENTS.includes(agent) && agent !== 'mock') {
    fail(`unknown agent '${agent}'; use ${AGENTS.join(' or ')}`);
  }
  const root = process.cwd();
  const fw = await detectFramework(root);
  const port = flag('port', '4517');
  const contentDir = flag('content') ?? (await pickContentDir(root, fw));
  const config = { agent, contentDir, port: Number(port) };
  const askModel = flag('ask-model');
  const resolveModel = flag('resolve-model');
  if (askModel) config.askModel = askModel;
  if (resolveModel) config.resolveModel = resolveModel;
  await mkdir(join(root, '.sidenote'), { recursive: true });
  await writeFile(
    join(root, '.sidenote', 'config.json'),
    JSON.stringify(config, null, 2) + '\n'
  );
  const overlay = `http://localhost:${port}/overlay.js`;
  if (fw) {
    console.log(`
sidenote configured (agent: ${agent}). ${fw.name} detected (${fw.config}).

Install the plugin:  npm install --save-dev remark-sidenote

Two one-time wiring steps:

${fw.steps(fw.config, overlay)}

Then run:  sidenote dev
Guide:     docs/guides/${fw.guide}.md in ${REPO}
`);
  } else {
    console.log(`
sidenote configured (agent: ${agent}).

Two one-time wiring steps in your site:

1) Stamp source offsets where you render markdown:

     import sidenoteOffsets from 'remark-sidenote';
     ...
     .use(sidenoteOffsets, { file: relativePathToThisMarkdownFile })

2) Load the overlay in dev only (e.g. in your layout):

     {process.env.NODE_ENV === 'development' && (
       <script src="${overlay}" defer />
     )}

Then run:  sidenote dev
`);
  }
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
