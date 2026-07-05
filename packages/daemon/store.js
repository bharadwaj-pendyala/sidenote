import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Flat-file comment store. Lives at <projectRoot>/.sidenote/comments.json so
 * comments travel with the site repo and survive reloads.
 */
const PATCHABLE = new Set(['status', 'diff', 'thread', 'body', 'mode']);

export class CommentStore {
  constructor(projectRoot) {
    this.path = join(projectRoot, '.sidenote', 'comments.json');
  }

  async #read() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  async #write(comments) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(comments, null, 2));
  }

  async list() {
    return this.#read();
  }

  async create({ file, startOffset, endOffset, quotedText, selectedText, body, mode }) {
    const comments = await this.#read();
    const comment = {
      id: `cmt_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      file,
      startOffset,
      endOffset,
      quotedText,
      selectedText,
      body,
      mode: mode === 'ask' ? 'ask' : 'edit',
      status: 'open',
      createdAt: new Date().toISOString(),
      thread: [],
    };
    comments.push(comment);
    await this.#write(comments);
    return comment;
  }

  async update(id, patch) {
    const comments = await this.#read();
    const comment = comments.find((c) => c.id === id);
    if (!comment) return null;
    for (const [key, value] of Object.entries(patch)) {
      if (PATCHABLE.has(key)) comment[key] = value;
    }
    await this.#write(comments);
    return comment;
  }

  async remove(id) {
    const comments = await this.#read();
    const next = comments.filter((c) => c.id !== id);
    if (next.length === comments.length) return false;
    await this.#write(next);
    return true;
  }
}
