#!/usr/bin/env node
import { createServer } from 'node:http';
import { CommentStore } from './store.js';

const PORT = Number(process.env.SIDENOTE_PORT) || 4517;
const projectRoot = process.env.SIDENOTE_ROOT || process.cwd();
const store = new CommentStore(projectRoot);

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
