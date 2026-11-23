# sidenote with Docusaurus

Works with docs, blog and pages, in `.md` and `.mdx`. Tested with
Docusaurus 3.

## 1. Install

```bash
npm install --save-dev remark-sidenote
npx sidenote-cli init --agent claude   # or --agent codex
```

`init` sees `docusaurus.config.js` and sets `contentDir` to `docs` (or
`blog` if there is no `docs` folder).

## 2. Stamp source offsets and load the overlay

Both go in `docusaurus.config.js`:

```js
import sidenote from 'remark-sidenote';

export default {
  // ...
  presets: [
    ['classic', {
      docs: { remarkPlugins: [sidenote] },
      blog: { remarkPlugins: [sidenote] },
      pages: { remarkPlugins: [sidenote] },
    }],
  ],
  headTags: process.env.NODE_ENV === 'development'
    ? [{
        tagName: 'script',
        attributes: { src: 'http://localhost:4517/overlay.js', defer: 'true' },
      }]
    : [],
};
```

`remark-sidenote` is an ES module, so the config must use `import` and
`export default` (Docusaurus 3 supports this). If your config is CommonJS,
rename it to `docusaurus.config.mjs`.

No `file` option is needed. Docusaurus passes the file being compiled, and
the plugin accounts for the frontmatter Docusaurus strips before parsing.

## 3. Run it

Run these in two terminals, from the project root:

```bash
npx docusaurus start
```

```bash
npx sidenote-cli dev
```

## Notes

- Comments attach to blocks: paragraphs, headings, list items and quotes.
  MDX components and code blocks are not stamped.
