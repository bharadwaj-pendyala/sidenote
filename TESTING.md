# Testing sidenote

Two ways to try it: a self-contained demo (no LLM), and a live run on a real site.

## A. Self-contained demo (no LLM, uses the mock adapter)

Proves the whole loop offline: select, comment, resolve, diff, accept.

```bash
# from the repo root
cd packages/overlay && npm install

# runs a real browser through select -> comment -> resolve -> diff -> accept -> delete
node e2e.mjs
```

To poke it by hand instead:

```bash
# 1. build the demo page from sample.md
cd packages/overlay && SIDENOTE_PORT=4517 node build-demo.js

# 2. start the daemon against a git repo whose agent is "mock"
#    (the demo dir must be inside a git repo with .sidenote/config.json {"agent":"mock"})

# 3. serve packages/overlay/demo/index.html over http and open it
```

## B. Live run on a real markdown site

Target: any site that renders markdown via `remark().use(remarkHtml)` (e.g. bharad-portfolio).

### One-time wiring

```bash
# in the site repo
npm install --save-dev remark-sidenote
npx sidenote-cli init --agent claude     # or --agent codex
```

Then the two steps `init` prints:

1. Add the offset stamper to the markdown pipeline:

   ```js
   import sidenoteOffsets from 'remark-sidenote';

   await remark()
     .use(sidenoteOffsets, { file: `content/posts/${slug}.md` }) // path relative to repo root
     .use(remarkHtml, { sanitize: false })
     .process(markdown);
   ```

2. Load the overlay in dev only (e.g. in the blog layout):

   ```jsx
   {process.env.NODE_ENV === 'development' && (
     <script src="http://localhost:4517/overlay.js" defer />
   )}
   ```

### Run

```bash
# terminal 1: the site
npm run dev

# terminal 2: the sidenote daemon (from the site repo root, so it edits the right files)
npx sidenote-cli dev --agent claude
```

Open a blog post in the browser. Select a passage, leave a comment, hit **Resolve**.
The daemon shells `claude` / `codex` to edit the source markdown, the page hot-reloads,
and the diff shows in the rail. **Accept** keeps it; **Reject** reverts the file.

### Requirements

- The site repo is a git repo with a clean-ish working tree (Reject uses `git checkout`).
- `claude` or `codex` is installed and on `PATH`.
- Comments target whole blocks (paragraph / heading / list item) in the MVP.

## C. UX checks with userlens

[userlens](https://github.com/bharadwaj-pendyala/userlens) runs the CLI and
the comment flow the way a user does and checks what they would see. The flow
runs in Chromium against a temp copy of the repo with the `mock` agent, so it
needs no LLM.

```bash
pip install 'userlens[browser]' && python -m playwright install chromium
eyes run                        # 7 cases: CLI, plus the comment flow at 1280px and 800px
eyes approve --case help        # accept output you reviewed
```

Cases live in `eyes/eyes.json` and reviewed output in `eyes/snapshots/`.
`eyes run` writes `artifacts/eyes/report.json` and a screenshot of every flow
step under `artifacts/eyes/cases/`.
