# Guides

sidenote works with any site that renders markdown through remark. These
guides cover the setups `sidenote init` detects:

- [Astro](./astro.md): `.md` pages and content collections
- [Docusaurus](./docusaurus.md): docs, blog and pages
- [Next.js](./nextjs.md): `@next/mdx` or your own `remark()` call

Using something else? Any remark or unified pipeline works: add
`remark-sidenote` and load `http://localhost:4517/overlay.js` in dev. Tools
that don't use remark (Hugo, Jekyll, VitePress's markdown-it) are not
supported yet; see the roadmap in the main README.
