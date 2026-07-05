#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CommentStore } from './store.js';
import { makeAdapter } from './adapters.js';
import { diffFile, revertFile } from './git.js';

const PORT = Number(process.env.SIDENOTE_PORT) || 4517;
const projectRoot = process.env.SIDENOTE_ROOT || process.cwd();
const store = new CommentStore(projectRoot);

async function loadConfig() {
  try {
    const cfg = JSON.parse(await readFile(join(projectRoot, '.sidenote', 'config.json'), 'utf8'));
    return { agent: process.env.SIDENOTE_AGENT || cfg.agent || 'claude' };
  } catch {
    return { agent: process.env.SIDENOTE_AGENT || 'claude' };
  }
}

async function resolveComments(file, comments) {
  const { agent } = await loadConfig();
  await makeAdapter(agent).resolve(projectRoot, file, comments);
  return diffFile(projectRoot, file);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
}

function validateNewComment(b) {
  if (typeof b.file !== 'string' || !b.file) return 'file is required';
  if (!Number.isInteger(b.startOffset)) return 'startOffset must be an integer';
  if (!Number.isInteger(b.endOffset)) return 'endOffset must be an integer';
  if (b.endOffset <= b.startOffset) return 'endOffset must be greater than startOffset';
  if (typeof b.body !== 'string' || !b.body.trim()) return 'body is required';
  return null;
}

const server = createServer(async (req, res) => {
  const { method } = req;
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (method === 'OPTIONS') return send(res, 204);
  if (method === 'GET' && path === '/health') return send(res, 200, { ok: true, projectRoot });

  if (method === 'GET' && path === '/overlay.js') {
    const overlayPath = fileURLToPath(new URL('../overlay/overlay.js', import.meta.url));
    const js = await readFile(overlayPath, 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/javascript', ...CORS });
    return res.end(js);
  }

  try {
    if (method === 'GET' && path === '/comments') {
      return send(res, 200, await store.list());
    }

    if (method === 'POST' && path === '/comments') {
      const body = await readJson(req);
      const error = validateNewComment(body);
      if (error) return send(res, 400, { error });
      return send(res, 201, await store.create(body));
    }

    if (method === 'POST' && path === '/resolve-all') {
      const open = (await store.list()).filter((c) => c.status === 'open');
      const byFile = new Map();
      for (const c of open) {
        if (!byFile.has(c.file)) byFile.set(c.file, []);
        byFile.get(c.file).push(c);
      }
      const results = [];
      for (const [file, comments] of byFile) {
        const diff = await resolveComments(file, comments);
        for (const c of comments) await store.update(c.id, { status: 'resolving', diff });
        results.push({ file, diff });
      }
      return send(res, 200, results);
    }

    const actionMatch = path.match(/^\/comments\/([\w-]+)\/(resolve|accept|reject)$/);
    if (method === 'POST' && actionMatch) {
      const [, id, action] = actionMatch;
      const comment = (await store.list()).find((c) => c.id === id);
      if (!comment) return send(res, 404, { error: 'not found' });

      if (action === 'resolve') {
        const diff = await resolveComments(comment.file, [comment]);
        const updated = await store.update(id, { status: 'resolving', diff });
        return send(res, 200, { comment: updated, diff });
      }
      if (action === 'accept') {
        return send(res, 200, await store.update(id, { status: 'resolved' }));
      }
      await revertFile(projectRoot, comment.file);
      return send(res, 200, await store.update(id, { status: 'open', diff: null }));
    }

    const idMatch = path.match(/^\/comments\/([\w-]+)$/);
    if (idMatch) {
      const id = idMatch[1];
      if (method === 'PATCH') {
        const updated = await store.update(id, await readJson(req));
        return updated ? send(res, 200, updated) : send(res, 404, { error: 'not found' });
      }
      if (method === 'DELETE') {
        const removed = await store.remove(id);
        return removed ? send(res, 204) : send(res, 404, { error: 'not found' });
      }
    }

    send(res, 404, { error: 'not found' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`sidenote daemon on http://localhost:${PORT}  (root: ${projectRoot})`);
});
