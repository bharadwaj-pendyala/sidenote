// In-browser stand-in for the sidenote daemon, used by the hosted playground.
// It implements the overlay's API (window.SIDENOTE_API) against the post's
// markdown, kept in this tab, with a scripted agent instead of claude/codex.
// Nothing leaves the browser unless the visitor turns on a real model with
// their own API key (see "optional real model" below). The real daemon lives
// in packages/daemon.
(() => {
  const ORIGINAL = window.SIDENOTE_PLAYGROUND.source;
  const FILE = window.SIDENOTE_PLAYGROUND.file;
  const KEY = 'sidenote-playground-v1';

  // --- state: comments and accepted edits, kept per browser ------------------
  const load = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && Array.isArray(saved.comments) && Array.isArray(saved.edits)) return saved;
    } catch {}
    return { comments: [], edits: [] };
  };
  const state = load();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  };
  let source = ORIGINAL;

  // --- the scripted agent ------------------------------------------------------
  // Hand-written rewrites for the post's main paragraphs, so the demo edit reads
  // like what a real agent returns. Anything else gets the filler-word pass.
  const REWRITES = {
    'So basically, every draft':
      'Every draft hides a better post. Editing is finding it and cutting everything around it.',
    'Reading your markdown in an editor':
      'Your editor hides how a post reads. Review the rendered page: styled headings, real line lengths and code blocks are where problems show up.',
    'When you spot something':
      "Don't fix as you go. Leave a note about what is wrong and keep reading, or you'll polish a paragraph you were about to cut.",
    'That is the whole loop':
      'That is the loop: read the page, comment, and accept or reject the diff that comes back.',
  };
  const ANSWERS = {
    'So basically, every draft':
      'Yes, for an intro it runs long: about 40 words to make one point. The idea, that a draft hides a better post, lands in the first clause. The rest is filler ("basically", "kind of", "just"). Press Resolve and I will cut it to two sentences.',
  };
  const FILLER = [
    [/\bSo basically, /g, ''],
    [/\bbasically /gi, ''],
    [/\bkind of /gi, ''],
    [/\breally /gi, ''],
    [/\bvery /gi, ''],
    [/\bjust /gi, ''],
    [/\bactually /gi, ''],
  ];
  const keyOf = (text) => Object.keys(REWRITES).find((k) => text.includes(k));
  const capitalize = (s) => s.replace(/^(\s*(?:[-*+]|\d+\.|#{1,6}|>)?\s*)([a-z])/, (_, a, b) => a + b.toUpperCase());

  function rewrite(passage) {
    const k = keyOf(passage);
    if (k) return REWRITES[k];
    let out = passage;
    for (const [re, to] of FILLER) out = out.replace(re, to);
    out = capitalize(out);
    if (out !== passage) return out;
    const sentences = passage.match(/[^.!?]+[.!?]+/g);
    if (sentences && sentences.length > 1) return sentences[0].trim();
    return null;
  }

  function answer(comment) {
    const passage = comment.quotedText;
    const asked = comment.thread.filter((t) => t.role === 'user').length > 0;
    if (asked)
      return 'Makes sense. When you are happy with the direction, press Resolve and I will turn this thread into an edit you can review as a diff.';
    const k = keyOf(passage);
    if (k && ANSWERS[k]) return ANSWERS[k];
    const words = passage.split(/\s+/).filter(Boolean).length;
    const fillers = FILLER.filter(([re]) => passage.match(new RegExp(re.source, 'i')));
    return (
      `This passage is ${words} words.` +
      (fillers.length
        ? ' It leans on filler words, so cutting those would tighten it without changing the meaning.'
        : ' It reads cleanly; I would leave it unless it repeats a point made elsewhere.') +
      ' (This playground agent is scripted. With claude or codex, sidenote answers using the whole post as context.)'
    );
  }

  // --- unified diff of the one file -------------------------------------------
  function diff(before, after) {
    const a = before.split('\n');
    const b = after.split('\n');
    let top = 0;
    while (top < a.length && top < b.length && a[top] === b[top]) top++;
    let tail = 0;
    while (tail < a.length - top && tail < b.length - top && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
    const ctx = 2;
    const start = Math.max(0, top - ctx);
    const aEnd = Math.min(a.length, a.length - tail + ctx);
    const bEnd = Math.min(b.length, b.length - tail + ctx);
    const lines = [
      `diff --git a/${FILE} b/${FILE}`,
      `--- a/${FILE}`,
      `+++ b/${FILE}`,
      `@@ -${start + 1},${aEnd - start} +${start + 1},${bEnd - start} @@`,
    ];
    for (let i = start; i < top; i++) lines.push(` ${a[i]}`);
    for (let i = top; i < a.length - tail; i++) lines.push(`-${a[i]}`);
    for (let i = top; i < b.length - tail; i++) lines.push(`+${b[i]}`);
    for (let i = b.length - tail; i < bEnd; i++) lines.push(` ${b[i]}`);
    return lines.join('\n') + '\n';
  }

  // --- applying an accepted edit to the page -----------------------------------
  const escapeHtml = (s) =>
    s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // Links keep only http(s) targets; anything else (javascript:, data:) shows
  // as its label text. The URL was HTML-escaped above, so it is safe in href.
  const link = (_, label, url) =>
    /^https?:\/\//i.test(url) ? `<a href="${url}" rel="noopener noreferrer">${label}</a>` : label;
  const inline = (md) =>
    escapeHtml(md.replace(/^(\s*(?:[-*+]|\d+\.|#{1,6}|>)\s+)/, ''))
      .replace(/\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, link)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Saved comments already carry shifted offsets, so a replay on load skips them.
  function applyEdit({ start, end, text }, shiftComments = false) {
    source = source.slice(0, start) + text + source.slice(end);
    const delta = text.length - (end - start);
    for (const el of document.querySelectorAll('[data-sn-file]')) {
      const s = Number(el.dataset.snStart);
      const e = Number(el.dataset.snEnd);
      if (s === start && e === end) {
        el.innerHTML = inline(text);
        el.dataset.snEnd = String(start + text.length);
      } else if (s >= end) {
        el.dataset.snStart = String(s + delta);
        el.dataset.snEnd = String(e + delta);
      } else if (e >= end) {
        el.dataset.snEnd = String(e + delta); // a list or quote that contains the edit
      }
    }
    if (!shiftComments) return;
    for (const c of state.comments) {
      if (c.startOffset >= end) {
        c.startOffset += delta;
        c.endOffset += delta;
      }
    }
  }

  const replay = () => state.edits.forEach((edit) => applyEdit(edit));
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', replay, { once: true });
  else replay();

  // --- streaming jobs, like the daemon's SSE registry --------------------------
  const jobs = new Map();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function startJob(id, run) {
    const job = { events: [], subs: new Set() };
    jobs.set(id, job);
    const emit = (evt) => {
      job.events.push(evt);
      for (const fn of [...job.subs]) fn(evt);
    };
    run(emit).then(
      (comment) => emit({ kind: 'done', comment }),
      (err) => emit({ kind: 'done', error: err.message })
    );
  }

  const find = (id) => state.comments.find((c) => c.id === id);
  const now = () => new Date().toISOString();
  const lineOf = (offset) => source.slice(0, offset).split('\n').length;

  // The agent is fixed when the action starts: one begun on the scripted agent
  // never turns into a billed API call because a key arrived meanwhile.
  async function runAsk(c, emit, agent = real) {
    emit({ kind: 'activity', text: `reading ${FILE}` });
    await sleep(350);
    emit({ kind: 'activity', text: `looking at lines ${lineOf(c.startOffset)}-${lineOf(c.endOffset)}` });
    await sleep(250);
    let reply;
    if (agent) {
      if (agent !== real) throw new Error('the key was forgotten before this request was sent.');
      emit({ kind: 'activity', text: `asking ${agent.model}` });
      reply = await agent.ask({ file: FILE, passage: c.quotedText, comment: c, post: source });
    } else {
      reply = answer(c);
    }
    const words = reply.split(/(\s+)/);
    for (const w of words) {
      emit({ kind: 'text', text: w });
      if (w.trim()) await sleep(18);
    }
    c.thread.push({ role: 'agent', text: words.join(''), at: now() });
    c.status = 'answered';
    save();
    return c;
  }

  async function runResolve(c, emit, agent = real) {
    emit({ kind: 'activity', text: `reading ${FILE}` });
    await sleep(350);
    const passage = source.slice(c.startOffset, c.endOffset);
    if (agent) {
      if (agent !== real) throw new Error('the key was forgotten before this request was sent.');
      emit({ kind: 'activity', text: `asking ${agent.model} to edit lines ${lineOf(c.startOffset)}-${lineOf(c.endOffset)}` });
    }
    const next = agent ? await agent.edit({ file: FILE, passage, comment: c }) : rewrite(passage);
    if (agent && next === passage) throw new Error('the model left the passage unchanged.');
    if (!next)
      throw new Error(
        'the playground agent has no edit for this passage. Try a paragraph, or install sidenote to use claude or codex.'
      );
    emit({ kind: 'activity', text: `editing lines ${lineOf(c.startOffset)}-${lineOf(c.endOffset)}` });
    await sleep(450);
    emit({ kind: 'activity', text: `git diff ${FILE}` });
    await sleep(200);
    const after = source.slice(0, c.startOffset) + next + source.slice(c.endOffset);
    c.diff = diff(source, after);
    c.proposed = next;
    c.status = 'resolving';
    save();
    return c;
  }

  window.SIDENOTE_API = {
    list: async () => state.comments,
    create: async (input) => {
      const c = {
        id: `cmt_${Math.random().toString(16).slice(2, 18)}`,
        file: input.file,
        startOffset: input.startOffset,
        endOffset: input.endOffset,
        quotedText: source.slice(input.startOffset, input.endOffset),
        selectedText: input.selectedText,
        body: input.body,
        mode: 'edit',
        status: 'open',
        createdAt: now(),
        thread: [],
      };
      state.comments.push(c);
      save();
      return c;
    },
    remove: async (id) => {
      state.comments = state.comments.filter((c) => c.id !== id);
      save();
    },
    ask: async (id) => {
      const c = find(id);
      if (!c) return { error: 'not found' };
      startJob(id, (emit) => runAsk(c, emit));
      return { streaming: true, id };
    },
    reply: async (id, text) => {
      const c = find(id);
      if (!c) return { error: 'not found' };
      c.thread.push({ role: 'user', text, at: now() });
      save();
      startJob(id, (emit) => runAsk(c, emit));
      return { streaming: true, id };
    },
    resolve: async (id) => {
      const c = find(id);
      if (!c) return { error: 'not found' };
      if (source.slice(c.startOffset, c.endOffset) !== c.quotedText) {
        c.status = 'stale';
        save();
        return { error: 'source changed since comment', comment: c };
      }
      startJob(id, (emit) => runResolve(c, emit));
      return { streaming: true, id };
    },
    accept: async (id) => {
      const c = find(id);
      if (!c || c.status !== 'resolving') return c;
      // Another accepted edit may have changed this passage since the proposal
      // was made (two comments on one paragraph). Splicing the proposal into
      // the old range would eat into the new text, so refuse it, like the
      // daemon's drift guard does.
      if (source.slice(c.startOffset, c.endOffset) !== c.quotedText) {
        Object.assign(c, { status: 'stale', diff: null, proposed: null });
        save();
        return c;
      }
      const edit = { start: c.startOffset, end: c.endOffset, text: c.proposed };
      c.status = 'resolved';
      c.endOffset = edit.start + edit.text.length;
      state.edits.push(edit);
      applyEdit(edit, true);
      save();
      return c;
    },
    reject: async (id) => {
      const c = find(id);
      if (!c) return null;
      Object.assign(c, { status: 'open', diff: null, proposed: null });
      save();
      return c;
    },
    stream: (id, onEvent) => {
      const job = jobs.get(id);
      if (!job) {
        onEvent({ kind: 'done' });
        return () => {};
      }
      for (const evt of job.events) onEvent(evt);
      job.subs.add(onEvent);
      return () => job.subs.delete(onEvent);
    },
  };

  // --- optional real model ("bring your own key") ---------------------------
  // The key is held only in this closure: never in localStorage, never in the
  // page URL. For tests, a page served from localhost may name a localhost API
  // (?anthropic_base_url=http://127.0.0.1:PORT); any other value is ignored,
  // so a crafted link can never send a visitor's key elsewhere.
  let real = null;
  const isLocal = (host) => host === 'localhost' || host === '127.0.0.1';
  function testBaseURL() {
    try {
      const value = new URLSearchParams(location.search).get('anthropic_base_url');
      if (!value || !isLocal(location.hostname)) return undefined;
      const url = new URL(value);
      return url.protocol === 'http:' && isLocal(url.hostname) ? url.origin : undefined;
    } catch {
      return undefined;
    }
  }
  window.SIDENOTE_PLAYGROUND.useKey = async (apiKey) => {
    const { createRealAgent } = await import('./real-agent.js');
    real = createRealAgent({ apiKey, baseURL: testBaseURL() });
    return real.model;
  };
  window.SIDENOTE_PLAYGROUND.forgetKey = () => {
    real = null;
  };

  window.SIDENOTE_PLAYGROUND.reset = () => {
    try {
      localStorage.removeItem(KEY);
    } catch {}
    location.reload();
  };
})();
