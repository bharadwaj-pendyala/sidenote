# sidenote with Next.js

There are two common setups. Use the one that matches how your site
renders markdown. Tested with Next.js 15.

## 1. Install

```bash
npm install --save-dev remark-sidenote
npx sidenote-cli init --agent claude   # or --agent codex
```

## 2a. `@next/mdx` (`.mdx` pages in `app/`)

```js
// next.config.mjs
import createMDX from '@next/mdx';

const withMDX = createMDX({
  options: { remarkPlugins: [['remark-sidenote', {}]] },
});

export default withMDX({ pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'] });
```

The plugin is named as a string so it also works with Turbopack, which
needs serializable options. The file path comes from the compiler, so
nothing else is needed.

## 2b. Your own `remark()` call (a typical markdown blog)

If you read `.md` files and render them with `remark()` yourself, pass the
path of the file you are rendering, relative to the project root:

```js
import { remark } from 'remark';
import remarkHtml from 'remark-html';
import sidenoteOffsets from 'remark-sidenote';

const html = String(
  await remark()
    .use(sidenoteOffsets, { file: `content/posts/${slug}.md` })
    .use(remarkHtml, { sanitize: false }) // keep the data-sn-* attributes
    .process(markdown)
);
```

Use `remark-rehype` and `rehype-stringify` instead? That works too: the
attributes are carried as `hProperties`. With a sanitizer (`remark-html`'s
default, or `rehype-sanitize`), allow `data-sn-*` or turn sanitizing off
in dev.

## 3. Load the overlay in dev only

```jsx
// app/layout.tsx
{process.env.NODE_ENV === 'development' && (
  <script src="http://localhost:4517/overlay.js" defer />
)}
```

The overlay waits for the page's `load` event before touching the DOM, so
it does not cause hydration mismatches.

## 4. Run it

Run these in two terminals, from the project root:

```bash
npx next dev
```

```bash
npx sidenote-cli dev
```
