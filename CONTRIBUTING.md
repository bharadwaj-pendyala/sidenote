# Contributing to sidenote

Thanks for your interest. sidenote is small and dependency-light on purpose; contributions that keep it that way are the easiest to merge.

## Getting set up

Each package is self-contained, so setup is minimal.

```bash
git clone https://github.com/bharadwaj-pendyala/sidenote.git
cd sidenote
npm install --prefix packages/remark-plugin   # the only package with deps
```

## Running the checks

```bash
npm test          # remark plugin + daemon suites (no browser)
npm run test:e2e  # full browser flow (needs Playwright installed)
```

`npm test` is what CI runs, so keep it green. CI also builds the playground. The e2e suite drives a real Chromium through select, comment, resolve, diff, accept, and needs a local Playwright install (see `packages/overlay/e2e.mjs` for the path it expects).

### Checking it the way a user does

User-facing behavior (the CLI output, the overlay, the playground) is checked
with [userlens](https://github.com/bharadwaj-pendyala/userlens). The cases live
in `eyes/eyes.json`:

```bash
pip install 'userlens[browser]'
eyes run                      # every case; report in artifacts/eyes/report.json
eyes run --case playground-phone
```

Add a case for any feature you build, before you build it. See `CLAUDE.md` for
the full loop.

### The playground

```bash
npm install --prefix packages/overlay
node packages/overlay/build-playground.js
python3 -m http.server -d packages/overlay/playground/dist 8000
```

The playground uses the real overlay with an in-browser backend
(`packages/overlay/playground/backend.js`) in place of the daemon.

## Good first issues

Look for the [`good first issue`](https://github.com/bharadwaj-pendyala/sidenote/labels/good%20first%20issue)
label. Framework guides and small overlay fixes are great places to start.

## Ground rules

- **No new runtime dependencies** without a reason in the PR description. The daemon is intentionally zero-dependency (Node builtins only).
- **Match the surrounding style:** ES modules, 2-space indent, no build step.
- **Comment the why, not the what.** The code is short; keep it readable.
- Every behavior change needs a matching check in one of the `verify*.js` suites.

## Submitting

1. Branch off `main`.
2. Make the change, add or adjust a verify check, run `npm test`.
3. Open a PR describing the change and how you tested it.

By contributing you agree your work is licensed under the [MIT License](./LICENSE).
