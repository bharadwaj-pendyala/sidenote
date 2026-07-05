# sidenote: Spec

> Review your rendered site like a Google Doc. Leave comments. An LLM resolves them into a clean git diff. You never leave the browser.

Status: **draft / MVP**. Built clean-room from first principles. Market tools studied only to learn *how they solved sub-problems*; none are the template.

---

## 1. Problem

Authoring content today (blog, portfolio) means a broken feedback loop:

1. Write markdown in an editor.
2. Preview the rendered result in a browser (local dev server).
3. Spot something wrong on the page.
4. **Switch to terminal / Claude Code, describe the fix, wait, switch back.**

Step 4 is the tax: a context-switch between browser and terminal on every correction. It kills flow.

The instinct that works everywhere else, reviewing a Google Doc by selecting text and leaving a comment, has no equivalent for your own rendered site backed by source files.

## 2. What sidenote is

A **review layer**, not an editor. You never type the fix. You annotate *intent*, an agent produces the edit.

The exact loop:

```
review rendered site in browser
  1. select passage, leave a comment          (Google-Docs muscle memory)
  2. comments pile up as anchored pins
  3. "Resolve all"
  4. agent reads each comment + its source span, patches the .md files
  5. one git diff
  6. Accept / Reject / Reply-and-rerun per comment
```

One sentence: **comment on your rendered markdown site, then apply all comments as one clean git diff.**

## 3. Non-goals (MVP)

- Not an editor. No inline typing of the fix (that competes with every CMS and dodges the point).
- Not a WYSIWYG. Source markdown stays the source of truth.
- No MDX / component-children mapping, no CMS hydration, no PDF/Docs surfaces yet. Those are later *adapters*, not a rewrite.
- No cloud. Everything runs on localhost against local files.
- No multi-user realtime collab.

## 4. First principles

1. **Source is truth.** The rendered DOM is a view; every comment must resolve to a byte range in a real source file. If we cannot map it, we do not accept the comment.
2. **Review, don't edit.** The human's job is intent; the agent's job is the edit. Clean separation.
3. **Never silently mutate.** Every agent change lands as a reviewable git diff. Diff-before-accept is mandatory, not optional.
4. **One engine, many surfaces.** The comment to span to agent to diff core is surface-agnostic. The browser overlay is only the first *capture surface*.
5. **Agent is pluggable.** The daemon shells to a headless coding CLI. `claude` and `codex` both supported from day one behind one interface. No API-key management in v1.

## 5. Architecture

```
+----------------------------------------------------------+
| Browser: your Next.js site on the local dev server       |
|                                                          |
|   rendered markdown  (blocks carry data-sn-* attrs)      |
|        |                                                 |
|   sidenote overlay  (injected script)                    |
|     - select text -> comment popover                     |
|     - sidebar of open comment threads                    |
|     - "Resolve all" / per-thread accept-reject           |
+---------------+------------------------------------------+
                |  HTTP (localhost)
                v
+----------------------------------------------------------+
| sidenote daemon  (Node, localhost:PORT)                  |
|   - comment store (JSON on disk, git-ignored)            |
|   - span resolver: data-sn-* -> {file, startOffset,end}  |
|   - agent adapter: claude | codex  (headless subprocess) |
|   - diff builder: git diff of agent's writes             |
+---------------+------------------------------------------+
                |
                v
        content/posts/*.md  on disk
                |
   dev server hot-reloads -> browser repaints
```

### 5.1 Source mapping: the crux, and why it is easy here

The general problem (DOM node to exact source file+line) is brittle. For the target site it nearly dissolves:

- Site renders `content/posts/*.md` via `remark().use(remarkHtml).process()`.
- **remark parses to an AST where every node carries `node.position`**: `start`/`end` with `line`, `column`, and **`offset`** (byte offset into the source string).
- We add a small **remark plugin** that, for each block-level node, stamps the emitted HTML with:
  - `data-sn-file`: source path relative to repo root
  - `data-sn-start`: start byte offset
  - `data-sn-end`: end byte offset
- The overlay reads these attributes off the nearest block ancestor of the selection. No fuzzy text matching, no guessing.

Byte offsets (not line numbers) because the agent edits by range and offsets survive reflow better. Fuzzy-text fallback is a later concern, only for surfaces without an AST.

### 5.2 Comment model

```jsonc
{
  "id": "cmt_01h...",
  "file": "content/posts/rag.md",
  "startOffset": 1240,
  "endOffset": 1389,
  "quotedText": "RAG retrieves documents and stuff",   // snapshot for drift-detection
  "body": "tighten this, too vague, name the retriever",
  "status": "open",            // open | resolving | resolved | rejected
  "createdAt": "2026-07-05T...",
  "thread": [ /* replies, each a re-run instruction */ ]
}
```

Comments persist to `.sidenote/comments.json` (git-ignored). Survive reload.

### 5.3 Resolve loop

- **Resolve all**: daemon groups open comments by file, builds one prompt per file containing each comment's span + quoted text + instruction, invokes the agent headless with write access scoped to `content/`.
- Agent edits the files. Daemon captures `git diff`, returns it to the overlay.
- Overlay renders the diff inline per comment. User Accepts (keep), Rejects (`git checkout` that hunk), or Replies (re-run that one comment with added guidance).
- **Drift guard**: before applying, if `quotedText` no longer matches the bytes at `[startOffset,endOffset]`, mark the comment stale and ask to re-anchor rather than patch blind.

### 5.4 Agent adapter

```
interface AgentAdapter {
  resolve(file, comments[]): Promise<void>   // edits file on disk
}
```

Implementations: `ClaudeAdapter` (shells `claude -p` headless), `CodexAdapter` (shells `codex exec`). Chosen by config/flag. Both installed locally.

## 6. MVP scope (the smallest shippable thing)

Target: **the author's own portfolio** (`bharad-portfolio`, Next.js + remark, plain `.md`, no MDX).

In:
- remark plugin stamping `data-sn-*` on block nodes.
- Overlay: select to comment, sidebar of open threads, "Resolve all", per-thread accept/reject/reply.
- Daemon: comment store, span resolver, one agent adapter working end-to-end, git-diff builder.
- Both `claude` and `codex` adapters (pluggable), pick via flag.

Out (later):
- MDX, tables, code blocks, embeds. Paragraphs / headings / list items / links only.
- Non-browser surfaces (VS Code, Docs, PDF).
- Instant per-keystroke inline editing.

## 7. Milestones

- **M0, Span injection.** remark plugin adds `data-sn-*`; verify offsets round-trip against the source file. No UI.
- **M1, Capture.** Overlay: select passage to comment, persist, survive reload. Sidebar lists threads. No agent yet.
- **M2, Resolve.** Daemon groups comments, invokes one agent adapter, writes edits, returns git diff. Accept/reject a hunk.
- **M3, Loop polish.** Reply-and-rerun per comment. Drift guard. Second adapter. `npx sidenote` dev-mode wiring.

## 8. Open questions

- Overlay delivery: dev-only injected script vs tiny Next.js integration package? (lean: dev-only script for MVP.)
- Scope of agent write access: hard-limit to `content/`? (yes for MVP.)
- Diff granularity: per-file vs per-comment hunks when comments overlap.
