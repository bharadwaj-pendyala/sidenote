#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommentStore } from './store.js';
import { makeAdapter } from './adapters.js';
import { changedFiles, diffFile, revertFile, revertPatch } from './git.js';

const PORT = Number(process.env.SIDENOTE_PORT) || 4517;
const HOST = '127.0.0.1';
const projectRoot = process.env.SIDENOTE_ROOT || process.cwd();
const store = new CommentStore(projectRoot);

function loadConfig() {
  try {
    const cfg = JSON.parse(readFileSync(join(projectRoot, '.sidenote', 'config.json'), 'utf8'));
    return {
      agent: process.env.SIDENOTE_AGENT || cfg.agent || 'claude',
      contentDir: cfg.contentDir || '.',
      askModel: cfg.askModel,
      resolveModel: cfg.resolveModel,
    };
  } catch {
    return { agent: process.env.SIDENOTE_AGENT || 'claude', contentDir: '.' };
  }
}

const config = loadConfig();
const contentRoot = resolve(projectRoot, config.contentDir);
const ALLOWED_EXT = new Set(['.md', '.mdx']);

// A comment's file must resolve to an allowed markdown file inside contentRoot.
// Blocks path traversal and keeps the agent's write surface inside the content dir.
function inScope(file) {
  if (typeof file !== 'string' || !file || isAbsolute(file)) return null;
  const abs = resolve(projectRoot, file);
  const rel = relative(contentRoot, abs);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  if (!ALLOWED_EXT.has(extname(abs))) return null;
  return abs;
}

async function sourceSlice(abs, start, end) {
  return (await readFile(abs, 'utf8')).slice(start, end);
}

// True if the source no longer matches the snapshot the comment anchored to.
async function isStale(comment) {
  const abs = inScope(comment.file);
  if (!abs) return true;
  try {
    return (await sourceSlice(abs, comment.startOffset, comment.endOffset)) !== comment.quotedText;
  } catch {
    return true;
  }
}

// Run the agent on one file's comments, then revert any edits it made outside
// that file so the write surface stays scoped to the target.
async function resolveComments(file, comments, onEvent) {
  const target = resolve(projectRoot, file);
  await makeAdapter(config.agent, config).resolve(projectRoot, file, comments, onEvent);
  for (const changed of await changedFiles(projectRoot)) {
    if (resolve(projectRoot, changed) !== target) await revertFile(projectRoot, changed);
  }
  return diffFile(projectRoot, file);
}

// Ask mode: the agent answers in the thread and writes nothing. Any stray edit
// is reverted so a question can never mutate the source.
async function answerComment(comment, onEvent) {
  const before = await changedFiles(projectRoot);
  const answer = await makeAdapter(config.agent, config).ask(projectRoot, comment.file, comment, onEvent);
  for (const changed of await changedFiles(projectRoot)) {
    if (!before.includes(changed)) await revertFile(projectRoot, changed);
  }
  const thread = [...(comment.thread || []), { role: 'agent', text: answer, at: now() }];
  return store.update(comment.id, { thread, status: 'answered' });
}

const now = () => new Date().toISOString();

// In-memory SSE job registry, keyed by comment id. A job streams the agent's
// live activity/text to any subscribers and buffers events so a subscriber that
// attaches mid-run still replays what it missed.
const jobs = new Map();

function job(id) {
  let j = jobs.get(id);
  if (!j) jobs.set(id, (j = { events: [], subs: new Set(), done: false }));
  return j;
}

function jobStart(id) {
  const j = job(id);
  j.events.length = 0;
  j.done = false;
}

function jobEmit(id, evt) {
  const j = jobs.get(id);
  if (!j) return;
  j.events.push(evt);
  const line = `data: ${JSON.stringify(evt)}\n\n`;
  for (const res of j.subs) res.write(line);
}

function jobDone(id, evt) {
  jobEmit(id, { kind: 'done', ...evt });
  const j = jobs.get(id);
  j.done = true;
  for (const res of j.subs) res.end();
  j.subs.clear();
  setTimeout(() => jobs.delete(id), 30_000);
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// Reject cross-origin callers and forged Host headers (DNS-rebinding guard):
// only localhost pages and same-machine tools may reach the daemon.
function callerOk(req) {
  const host = (req.headers.host || '').split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') return false;
  const { origin } = req.headers;
  if (!origin) return true;
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1';
  } catch {
    return false;
  }
}

function send(res, status, body, origin) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors(origin) });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

function validateNewComment(b) {
  if (!inScope(b.file)) return 'file must be a markdown file inside the content dir';
  if (!Number.isInteger(b.startOffset)) return 'startOffset must be an integer';
  if (!Number.isInteger(b.endOffset)) return 'endOffset must be an integer';
  if (b.endOffset <= b.startOffset) return 'endOffset must be greater than startOffset';
  if (typeof b.body !== 'string' || !b.body.trim()) return 'body is required';
  return null;
}

const server = createServer(async (req, res) => {
  const { method } = req;
  const { origin } = req.headers;
  if (!callerOk(req)) return send(res, 403, { error: 'forbidden' }, origin);

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (method === 'OPTIONS') return send(res, 204, undefined, origin);
  if (method === 'GET' && path === '/health')
    return send(res, 200, { ok: true, projectRoot }, origin);

  if (method === 'GET' && path === '/overlay.js') {
    const overlayPath = fileURLToPath(new URL('../overlay/overlay.js', import.meta.url));
    const js = await readFile(overlayPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript', ...cors(origin) });
    return res.end(js);
  }

  const streamMatch = path.match(/^\/comments\/([\w-]+)\/stream$/);
  if (method === 'GET' && streamMatch) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...cors(origin),
    });
    const j = job(streamMatch[1]);
    for (const evt of j.events) res.write(`data: ${JSON.stringify(evt)}\n\n`);
    if (j.done) return res.end();
    j.subs.add(res);
    req.on('close', () => j.subs.delete(res));
    return;
  }

  try {
    if (method === 'GET' && path === '/comments') {
      return send(res, 200, await store.list(), origin);
    }

    if (method === 'POST' && path === '/comments') {
      const body = await readJson(req);
      const error = validateNewComment(body);
      if (error) return send(res, 400, { error }, origin);

      // Snapshot the source range server-side so drift detection compares
      // against the real bytes, not the overlay's rendered text.
      let quotedText = typeof body.quotedText === 'string' ? body.quotedText : '';
      try {
        quotedText = await sourceSlice(inScope(body.file), body.startOffset, body.endOffset);
      } catch {}

      const created = await store.create({
        file: body.file,
        startOffset: body.startOffset,
        endOffset: body.endOffset,
        quotedText,
        selectedText: typeof body.selectedText === 'string' ? body.selectedText : quotedText,
        body: body.body,
        mode: body.mode,
      });
      return send(res, 201, created, origin);
    }

    if (method === 'POST' && path === '/resolve-all') {
      const open = (await store.list()).filter((c) => c.status === 'open');
      const byFile = new Map();
      for (const c of open) {
        if (await isStale(c)) {
          await store.update(c.id, { status: 'stale' });
          continue;
        }
        if (!byFile.has(c.file)) byFile.set(c.file, []);
        byFile.get(c.file).push(c);
      }
      const results = [];
      for (const [file, comments] of byFile) {
        const diff = await resolveComments(file, comments);
        for (const c of comments) await store.update(c.id, { status: 'resolving', diff });
        results.push({ file, diff });
      }
      return send(res, 200, results, origin);
    }

    const actionMatch = path.match(/^\/comments\/([\w-]+)\/(resolve|accept|reject|reply|ask)$/);
    if (method === 'POST' && actionMatch) {
      const [, id, action] = actionMatch;
      const comment = (await store.list()).find((c) => c.id === id);
      if (!comment) return send(res, 404, { error: 'not found' }, origin);

      // Ask/Reply: agent answers in the thread, never touches the file. Runs as
      // a streaming job; the caller watches /comments/:id/stream for progress.
      if (action === 'ask' || action === 'reply') {
        let target = comment;
        if (action === 'reply') {
          const { text } = await readJson(req);
          if (typeof text !== 'string' || !text.trim())
            return send(res, 400, { error: 'text is required' }, origin);
          const thread = [...(comment.thread || []), { role: 'user', text: text.trim(), at: now() }];
          target = await store.update(id, { thread });
        }
        jobStart(id);
        send(res, 202, { streaming: true, id }, origin);
        answerComment(target, (evt) => jobEmit(id, evt))
          .then((final) => jobDone(id, { comment: final }))
          .catch((err) => jobDone(id, { error: err.message }));
        return;
      }

      // Resolve: edit the source (streaming job). Prior Ask discussion rides along.
      if (action === 'resolve') {
        if (await isStale(comment)) {
          const stale = await store.update(id, { status: 'stale' });
          return send(res, 409, { error: 'source changed since comment', comment: stale }, origin);
        }
        jobStart(id);
        send(res, 202, { streaming: true, id }, origin);
        resolveComments(comment.file, [comment], (evt) => jobEmit(id, evt))
          .then((diff) => store.update(id, { status: 'resolving', diff }))
          .then((updated) => jobDone(id, { comment: updated }))
          .catch((err) => jobDone(id, { error: err.message }));
        return;
      }
      if (action === 'accept') {
        return send(res, 200, await store.update(id, { status: 'resolved' }), origin);
      }
      // reject: reverse just this comment's captured patch; fall back to whole-file revert
      if (comment.diff) await revertPatch(projectRoot, comment.diff);
      else await revertFile(projectRoot, comment.file);
      return send(res, 200, await store.update(id, { status: 'open', diff: null }), origin);
    }

    const idMatch = path.match(/^\/comments\/([\w-]+)$/);
    if (idMatch) {
      const id = idMatch[1];
      if (method === 'PATCH') {
        const updated = await store.update(id, await readJson(req));
        return updated
          ? send(res, 200, updated, origin)
          : send(res, 404, { error: 'not found' }, origin);
      }
      if (method === 'DELETE') {
        const removed = await store.remove(id);
        return removed
          ? send(res, 204, undefined, origin)
          : send(res, 404, { error: 'not found' }, origin);
      }
    }

    send(res, 404, { error: 'not found' }, origin);
  } catch (err) {
    send(res, 500, { error: err.message }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`sidenote daemon on http://${HOST}:${PORT}  (root: ${projectRoot})`);
});
