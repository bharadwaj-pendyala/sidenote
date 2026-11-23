# sidenote with Astro

Works with `.md` pages in `src/pages` and with content collections. Tested
with Astro 5.

## 1. Install

```bash
npm install --save-dev remark-sidenote
npx sidenote-cli init --agent claude   # or --agent codex
```

`init` sees `astro.config.mjs` and sets `contentDir` to `src/content`.

## 2. Stamp source offsets

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import sidenote from 'remark-sidenote';

export default defineConfig({
  markdown: { remarkPlugins: [sidenote] },
});
```

No `file` option is needed: Astro passes the file being compiled, and the
plugin turns it into a path relative to the project root. Frontmatter that
Astro strips before parsing is accounted for, so offsets point into the
file on disk.

If you use `@astrojs/mdx`, it inherits `markdown.remarkPlugins` by default.

## 3. Load the overlay in dev only

In the layout your posts use, inside `<head>`:

```astro
{import.meta.env.DEV && (
  <script is:inline src="http://localhost:4517/overlay.js" defer></script>
)}
```

`is:inline` stops Astro from bundling a script that lives on another
origin. The tag is left out of `astro build` output.

## 4. Run it

Run these in two terminals, from the project root:

```bash
npx astro dev
```

```bash
npx sidenote-cli dev
```

Open a post, select a passage, and comment.

## Troubleshooting

- **No `+ Comment` button:** the selected text is not inside a stamped block.
  Check that the page HTML has `data-sn-file` attributes. If not, the
  plugin is not in `markdown.remarkPlugins`.
- **Content collection changes don't show up:** Astro caches collection
  output. Delete `.astro/` and `node_modules/.astro/`, then restart.
- **"source changed since comment":** the file changed after you commented
  (the drift guard). Delete the comment and comment again.
