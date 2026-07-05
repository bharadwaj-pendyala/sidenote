# sidenote: UX

Settled UX for the MVP. The design goal: **one-time setup, invisible thereafter, benefits unbounded.**

## Setup (one time, per site)

```
npx sidenote init
```

Does three things, once:

1. Adds the remark plugin (`data-sn-*` stamper) to the site's markdown pipeline.
2. Drops a dev-only `<script>` that loads the overlay when `NODE_ENV === 'development'`.
3. Writes `.sidenote/config.json` (agent = `claude` | `codex`, content dir, port).

After that the author runs their normal `npm run dev`. Every previewed page wears the comment layer with no extra step.

## Comment surface

On the rendered page, in the browser. No separate app or window.

- **Select text**, a floating `+ Comment` button appears (Google-Docs / Medium muscle memory).
- Type the intent, save. The comment pins to that passage.
- A **right-side rail** lists every open thread, like the Docs comment sidebar.
- Pins persist across reload via `.sidenote/comments.json`.

```
+-----------------------------------------------+------------------+
|  RENDERED BLOG POST                            |  sidenote rail   |
|                                                |                  |
|  RAG retrieves documents and stuff to ground   |  [1] "too vague, |
|  ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ selected    |      name it"     |
|         floating [+ Comment]                   |      · open       |
|                                                |                  |
|  The attention mechanism lets tokens...        |  [2] "add a link" |
|                                                |      · open       |
+-----------------------------------------------+------------------+
```

## Comment to LLM transfer

The overlay never calls an LLM directly. It talks to the local daemon, which shells the headless agent already installed.

```
overlay  --POST comment-->  daemon (localhost)
daemon:  read data-sn-* offsets  ->  resolve {file, startOffset, endOffset}
         build prompt (span + quoted text + instruction)
         spawn agent headless, scoped to content/   (claude -p | codex exec)
```

No API keys, no cloud. Everything on localhost against local files.

## Auto-update loop

```
agent writes content/posts/*.md
   -> dev server hot-reload sees the change
   -> browser repaints with new prose
   -> daemon returns git diff -> rail shows it under the comment
   -> author clicks  Accept | Reject | Reply-and-rerun
```

The page changes under the author; they accept or reject in the rail. No terminal, no manual refresh, no copy-paste.

## Resolve timing

- **Default: instant per comment.** Saving a comment resolves it immediately for a tight loop.
- **Opt-in: batch.** `Resolve all` runs one coherent pass over all open comments (cheaper, page-wide consistency). Kept as an explicit action for multi-edit sessions.

## Accept / Reject / Reply

Per thread, in the rail:

- **Accept**: keep the agent's edit, mark comment resolved.
- **Reject**: `git checkout` that hunk, comment returns to open.
- **Reply**: add guidance ("still too long"), re-run the agent on just that comment.

## Settled decisions

| Question | Decision |
|---|---|
| Setup mechanism | Injected dev script via `npx sidenote init` |
| Diff review surface | In-browser rail, inline diff |
| Default resolve timing | Instant per comment (batch is opt-in) |
| Source mapping | remark `node.position` byte offsets, no fuzzy fallback in MVP |
| Agent backends | `claude` and `codex`, pluggable |
