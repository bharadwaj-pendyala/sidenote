# sidenote

**Comment on your rendered markdown site like a Google Doc. An LLM resolves the comments into a clean git diff. You never leave the browser.**

sidenote is a review layer for content authors. You review your own site on the local dev server, select a passage, and leave a comment describing the fix you want, exactly like commenting in Google Docs or Word. Instead of a human resolving the comment, a local coding agent (`claude` or `codex`) patches the source markdown and hands you back a git diff to accept or reject.

It is **not an editor**. You annotate intent; the agent makes the edit. Source markdown stays the source of truth.

## Why

Authoring a blog means bouncing between the browser (to see the rendered page) and the terminal (to ask an agent for a fix). That context-switch is the tax. sidenote closes the loop inside the browser.

## Status

Early. Building the MVP against a Next.js + remark markdown site. See [SPEC.md](./SPEC.md) for the design.

## License

MIT
