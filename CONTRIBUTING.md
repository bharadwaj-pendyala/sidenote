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

`npm test` is what CI runs, so keep it green. The e2e suite drives a real Chromium through select, comment, resolve, diff, accept, and needs a local Playwright install (see `packages/overlay/e2e.mjs` for the path it expects).

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
