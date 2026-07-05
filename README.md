# sidenote

**Comment on your rendered markdown site like a Google Doc. An LLM resolves the comments into a clean git diff. You never leave the browser.**

sidenote is a review layer for content authors. You review your own site on the local dev server, select a passage, and leave a comment describing the fix you want, exactly like commenting in Google Docs or Word. Instead of a human resolving the comment, a local coding agent (`claude` or `codex`) patches the source markdown and hands you back a git diff to accept or reject.

It is **not an editor**. You annotate intent; the agent makes the edit. Source markdown stays the source of truth.

## Why

Authoring a blog means bouncing between the browser (to see the rendered page) and the terminal (to ask an agent for a fix). That context-switch is the tax. sidenote closes the loop inside the browser.

## Status

MVP loop works end to end: select on the rendered page, comment, resolve, review the git diff, accept or reject. See [SPEC.md](./SPEC.md) for the design and [TESTING.md](./TESTING.md) to try it.

```
packages/
  remark-plugin/   stamps source byte offsets onto rendered HTML blocks
  daemon/          localhost comment store + resolve loop (claude | codex | mock)
  overlay/         injected browser overlay: select to comment, rail, live diff
bin/sidenote.js    init + dev CLI
```

Quick start:

```bash
npx sidenote init --agent claude   # one-time wiring (prints 2 steps)
npx sidenote dev                   # run the daemon next to your site
```

## License

MIT
