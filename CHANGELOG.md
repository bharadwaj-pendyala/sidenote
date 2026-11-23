# Changelog

All notable changes to `sidenote-cli` and `remark-sidenote`. Both packages
share a version number.

## 0.1.0

### Added

- **Live playground** at https://sidenote-playground.vercel.app: try the whole
  loop (select, comment, ask, resolve, diff, accept) in the browser with no
  install. Built by `packages/overlay/build-playground.js`.
- **`sidenote init` detects Astro, Docusaurus and Next.js** and prints the
  wiring for that framework. It also picks the content folder (`--content`
  still wins).
- **Framework guides** in `docs/guides/` for Astro, Docusaurus and Next.js.
- `remark-sidenote` takes the file path from the vfile when `file` is not
  passed, so it works in frameworks that configure remark once for every page.
  A new `root` option sets what the path is relative to (default: the current
  directory).
- The overlay accepts a custom backend as `window.SIDENOTE_API`.

### Fixed

- Offsets now point into the file on disk when the framework strips the
  frontmatter before parsing (Astro content collections, Docusaurus). Before,
  comments on those pages patched the wrong text or were flagged as stale.
- The `+ Comment` button could fail to appear after a fast triple-click on a
  busy page.
- On phones, the comment rail no longer covers the page; it sits under the
  content.

## 0.0.1

First public release: select-to-comment overlay, Ask and Resolve with
`claude` or `codex`, inline git diff with Accept and Reject, drift guard.
