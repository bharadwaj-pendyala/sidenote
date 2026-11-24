// Builds the hosted playground: one static page where a visitor can try the
// whole sidenote loop (select, comment, ask, resolve, diff, accept) with no
// install. The overlay is the real one; the backend is the in-browser stand-in
// in playground/backend.js. Output: playground/dist/index.html
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import sidenoteOffsets from '../remark-plugin/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const FILE = 'posts/editing.md';
const REPO = 'https://github.com/bharadwaj-pendyala/sidenote';
const IMAGE = 'https://raw.githubusercontent.com/bharadwaj-pendyala/sidenote/main/docs/images/04-diff.png';

const source = await readFile(join(here, 'playground', 'post.md'), 'utf8');
const backend = await readFile(join(here, 'playground', 'backend.js'), 'utf8');
const overlay = await readFile(join(here, 'overlay.js'), 'utf8');

const article = String(
  await remark()
    .use(sidenoteOffsets, { file: FILE })
    .use(remarkHtml, { sanitize: false })
    .process(source)
);

// </script> inside inlined JSON or code would end the tag early.
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const description =
  'Try sidenote in your browser: select text on a rendered page, leave a comment, and get the edit back as a git diff.';

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sidenote playground</title>
<meta name="description" content="${description}">
<meta property="og:title" content="sidenote: comment on your rendered markdown, get a git diff">
<meta property="og:description" content="${description}">
<meta property="og:image" content="${IMAGE}">
<meta name="twitter:card" content="summary_large_image">
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #fff; color: #1a1a1a; font: 18px/1.65 Georgia, 'Times New Roman', serif; }
  main { max-width: 660px; margin: 0 auto; padding: 24px 20px 64px; }
  #pg-banner { font: 14px/1.5 -apple-system, system-ui, sans-serif; background: #fffbe6;
    border: 1px solid #f0e2a0; border-radius: 10px; padding: 14px 16px; margin: 8px 0 32px; color: #3a3420; }
  #pg-banner strong { color: #1a1a1a; }
  #pg-banner ol { margin: 8px 0 10px; padding-left: 20px; }
  #pg-banner .pg-links { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
  #pg-banner a { color: #0b57d0; }
  #pg-banner .pg-links button, #pg-forget { font: inherit; background: none; border: 0; padding: 0; color: #0b57d0;
    text-decoration: underline; cursor: pointer; }
  #pg-real { margin-top: 12px; border-top: 1px solid #f0e2a0; padding-top: 10px; }
  #pg-real-toggle { font: inherit; background: none; border: 0; padding: 0; color: #0b57d0;
    cursor: pointer; text-align: left; }
  #pg-real-toggle::before { content: '\\25B8  '; }
  #pg-real-toggle[aria-expanded="true"]::before { content: '\\25BE  '; }
  #pg-real p { margin: 8px 0; }
  #pg-real label { display: block; font-weight: 600; margin-bottom: 4px; }
  #pg-real .pg-row { display: flex; gap: 8px; flex-wrap: wrap; }
  #pg-key { flex: 1 1 200px; min-width: 0; font: 14px ui-monospace, monospace; padding: 6px 8px;
    border: 1px solid #c9bd86; border-radius: 6px; background: #fff; }
  #pg-use { font: inherit; padding: 6px 12px; border: 0; border-radius: 6px; background: #1a1a1a;
    color: #fff; cursor: pointer; }
  #pg-real-status:empty { display: none; }
  article h1 { font-size: 34px; line-height: 1.2; margin: 0 0 20px; }
  article h2 { font-size: 23px; margin: 36px 0 8px; }
  footer { font: 14px/1.6 -apple-system, system-ui, sans-serif; color: #555; border-top: 1px solid #eee;
    margin-top: 48px; padding-top: 20px; }
  footer pre { background: #0d1117; color: #c9d1d9; padding: 12px 14px; border-radius: 8px;
    overflow-x: auto; font: 13px/1.5 ui-monospace, monospace; }
  footer a { color: #0b57d0; }
</style>
</head>
<body>
<main>
  <div id="pg-banner" role="note">
    <strong>This is the sidenote live playground.</strong> It is a rendered blog post, like yours.
    <ol>
      <li>Select a sentence in the post and press <strong>+ Comment</strong>.</li>
      <li>Press <strong>Ask</strong> to discuss it, or <strong>Resolve</strong> to get the edit as a diff.</li>
      <li><strong>Accept</strong> it and the page updates.</li>
    </ol>
    The agent here is a scripted stand-in that runs in your browser. On your own site, sidenote uses
    <code>claude</code> or <code>codex</code> and edits the real markdown file.
    <div class="pg-links">
      <a href="${REPO}">GitHub</a>
      <a href="${REPO}#quick-start">Install</a>
      <a href="https://www.npmjs.com/package/sidenote-cli">npm</a>
      <button type="button" id="pg-reset">Reset playground</button>
    </div>
    <div id="pg-real">
      <button type="button" id="pg-real-toggle" aria-expanded="false" aria-controls="pg-real-panel">Try it with a real model, using your own Anthropic API key</button>
      <div id="pg-real-panel" hidden>
      <p>Ask and Resolve then call Claude from your browser with your key. The key stays in this
      tab's memory only: it is not saved, and it is sent only to the Anthropic API. Reloading the
      page forgets it. Requests are billed to your key.</p>
      <form id="pg-key-form" autocomplete="off">
        <label for="pg-key">Anthropic API key</label>
        <div class="pg-row">
          <input id="pg-key" type="password" placeholder="sk-ant-..." spellcheck="false" required>
          <button type="submit" id="pg-use">Use this key</button>
        </div>
      </form>
      <p id="pg-real-status" role="status"></p>
      <button type="button" id="pg-forget" hidden>Forget the key</button>
      </div>
    </div>
  </div>
  <article>${article}</article>
  <footer>
    <p>Use it on your own Astro, Docusaurus, Next.js or remark site:</p>
    <pre>npm install --save-dev remark-sidenote
npx sidenote-cli init
npx sidenote-cli dev</pre>
    <p><a href="${REPO}">sidenote on GitHub</a>. MIT licensed. Local-first: your files never leave your machine.</p>
  </footer>
</main>
<script>window.SIDENOTE_PLAYGROUND = ${safe(JSON.stringify({ source, file: FILE }))};</script>
<script>${safe(backend)}</script>
<script>${safe(overlay)}</script>
<script>
  document.getElementById('pg-reset').addEventListener('click', () => window.SIDENOTE_PLAYGROUND.reset());
  (() => {
    const toggle = document.getElementById('pg-real-toggle');
    const panel = document.getElementById('pg-real-panel');
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      if (open) document.getElementById('pg-key').focus();
    });
    const form = document.getElementById('pg-key-form');
    const input = document.getElementById('pg-key');
    const status = document.getElementById('pg-real-status');
    const forget = document.getElementById('pg-forget');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const key = input.value.trim();
      if (!key) return;
      status.textContent = 'Loading...';
      try {
        const model = await window.SIDENOTE_PLAYGROUND.useKey(key);
        input.value = '';
        form.hidden = true;
        forget.hidden = false;
        status.textContent = 'Real model on: Ask and Resolve now use ' + model + ' with your key.';
      } catch (err) {
        status.textContent = 'Could not load the real model: ' + err.message;
      }
    });
    forget.addEventListener('click', () => {
      window.SIDENOTE_PLAYGROUND.forgetKey();
      form.hidden = false;
      forget.hidden = true;
      status.textContent = 'Key forgotten. Ask and Resolve use the scripted agent again.';
    });
  })();
</script>
</body>
</html>
`;

await mkdir(join(here, 'playground', 'dist'), { recursive: true });
await writeFile(join(here, 'playground', 'dist', 'index.html'), html);
// The real-model agent is its own file, fetched only when a visitor opts in.
await build({
  entryPoints: [join(here, 'playground', 'real-agent.js')],
  outfile: join(here, 'playground', 'dist', 'real-agent.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  legalComments: 'none',
  logLevel: 'warning',
});
console.log('wrote playground/dist/index.html');
