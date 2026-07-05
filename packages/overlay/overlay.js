(() => {
  const PORT = window.SIDENOTE_PORT || 4517;
  const API = `http://localhost:${PORT}`;

  const api = {
    list: () => fetch(`${API}/comments`).then((r) => r.json()),
    create: (c) =>
      fetch(`${API}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(c),
      }).then((r) => r.json()),
    remove: (id) => fetch(`${API}/comments/${id}`, { method: 'DELETE' }),
    resolve: (id) => fetch(`${API}/comments/${id}/resolve`, { method: 'POST' }).then((r) => r.json()),
    accept: (id) => fetch(`${API}/comments/${id}/accept`, { method: 'POST' }).then((r) => r.json()),
    reject: (id) => fetch(`${API}/comments/${id}/reject`, { method: 'POST' }).then((r) => r.json()),
  };

  const blockOf = (node) => {
    const el = node.nodeType === 1 ? node : node.parentElement;
    return el?.closest('[data-sn-file]');
  };

  // --- styles -------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    #sn-rail { position: fixed; top: 0; right: 0; width: 300px; height: 100vh;
      overflow-y: auto; background: #fafafa; border-left: 1px solid #e2e2e2;
      font: 13px/1.5 -apple-system, system-ui, sans-serif; padding: 16px 14px;
      box-sizing: border-box; z-index: 2147483000; }
    #sn-rail h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em;
      color: #888; margin: 0 0 12px; }
    .sn-card { background: #fff; border: 1px solid #e6e6e6; border-radius: 8px;
      padding: 10px; margin-bottom: 10px; }
    .sn-card .sn-quote { color: #666; font-size: 12px; border-left: 2px solid #ddd;
      padding-left: 8px; margin-bottom: 6px; }
    .sn-card .sn-body { color: #111; }
    .sn-card .sn-actions { margin-top: 8px; display: flex; gap: 8px; }
    .sn-card button { font: inherit; cursor: pointer; border: 1px solid #ddd;
      background: #f6f6f6; border-radius: 6px; padding: 3px 8px; }
    .sn-card .sn-diff { background: #0d1117; color: #c9d1d9; font: 11px/1.4 ui-monospace, monospace;
      padding: 8px; border-radius: 6px; margin: 8px 0 0; overflow-x: auto; white-space: pre; max-height: 180px; }
    .sn-card .sn-done { color: #2e7d32; font-size: 12px; align-self: center; }
    .sn-anchored { background: rgba(255, 214, 0, .28); border-radius: 2px; cursor: pointer; }
    .sn-flash { animation: sn-flash 1s ease; }
    @keyframes sn-flash { from { background: rgba(255,214,0,.7);} to { background: rgba(255,214,0,.28);} }
    #sn-add { position: absolute; z-index: 2147483001; transform: translate(-50%, -100%);
      background: #111; color: #fff; border: 0; border-radius: 6px; padding: 5px 10px;
      font: 12px system-ui; cursor: pointer; display: none; }
    #sn-pop { position: absolute; z-index: 2147483002; width: 240px; background: #fff;
      border: 1px solid #ccc; border-radius: 8px; padding: 10px; display: none;
      box-shadow: 0 6px 24px rgba(0,0,0,.15); }
    #sn-pop textarea { width: 100%; box-sizing: border-box; height: 60px; resize: vertical;
      font: 13px system-ui; border: 1px solid #ddd; border-radius: 6px; padding: 6px; }
    #sn-pop .sn-actions { margin-top: 8px; display: flex; justify-content: flex-end; gap: 6px; }
  `;
  document.head.appendChild(style);

  const rail = document.createElement('aside');
  rail.id = 'sn-rail';
  rail.innerHTML = '<h2>sidenote</h2><div id="sn-list"></div>';
  document.body.appendChild(rail);
  document.body.style.marginRight = '300px';
  const list = rail.querySelector('#sn-list');

  const addBtn = document.createElement('button');
  addBtn.id = 'sn-add';
  addBtn.textContent = '+ Comment';
  document.body.appendChild(addBtn);

  const pop = document.createElement('div');
  pop.id = 'sn-pop';
  pop.innerHTML =
    '<textarea placeholder="What should change?"></textarea>' +
    '<div class="sn-actions"><button data-sn-cancel>Cancel</button>' +
    '<button data-sn-save>Comment</button></div>';
  document.body.appendChild(pop);
  const textarea = pop.querySelector('textarea');

  let pending = null; // { block, quotedText }

  // --- selection → floating add button ------------------------------------
  document.addEventListener('selectionchange', () => {
    if (pop.style.display === 'block') return;
    const sel = document.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      addBtn.style.display = 'none';
      return;
    }
    const block = blockOf(sel.anchorNode);
    if (!block) {
      addBtn.style.display = 'none';
      return;
    }
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    addBtn.style.left = `${rect.left + rect.width / 2 + scrollX}px`;
    addBtn.style.top = `${rect.top + scrollY - 6}px`;
    addBtn.style.display = 'block';
    pending = { block, quotedText: sel.toString().trim() };
  });

  addBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (!pending) return;
    addBtn.style.display = 'none';
    pop.style.left = addBtn.style.left;
    pop.style.top = `${parseFloat(addBtn.style.top) + 8}px`;
    pop.style.display = 'block';
    textarea.value = '';
    textarea.focus();
  });

  pop.querySelector('[data-sn-cancel]').addEventListener('click', closePop);
  pop.querySelector('[data-sn-save]').addEventListener('click', async () => {
    const body = textarea.value.trim();
    if (!body || !pending) return closePop();
    const { block } = pending;
    await api.create({
      file: block.dataset.snFile,
      startOffset: Number(block.dataset.snStart),
      endOffset: Number(block.dataset.snEnd),
      quotedText: block.textContent.trim(),
      body,
    });
    closePop();
    render();
  });

  function closePop() {
    pop.style.display = 'none';
    pending = null;
    document.getSelection()?.removeAllRanges();
  }

  // --- render rail + anchors ----------------------------------------------
  function findBlock(c) {
    return [...document.querySelectorAll('[data-sn-file]')].find(
      (el) =>
        el.dataset.snFile === c.file &&
        Number(el.dataset.snStart) === c.startOffset &&
        Number(el.dataset.snEnd) === c.endOffset
    );
  }

  async function render() {
    document.querySelectorAll('.sn-anchored').forEach((el) => el.classList.remove('sn-anchored'));
    const comments = await api.list();
    list.innerHTML = '';
    for (const c of comments) {
      const block = findBlock(c);
      if (block) block.classList.add('sn-anchored');

      const card = document.createElement('div');
      card.className = 'sn-card';
      const diffHtml =
        c.status === 'resolving' && c.diff ? `<pre class="sn-diff">${escapeHtml(c.diff)}</pre>` : '';
      const actions =
        {
          open: '<button data-resolve>Resolve</button><button data-del>Delete</button>',
          resolving: '<button data-accept>Accept</button><button data-reject>Reject</button>',
          resolved: '<span class="sn-done">resolved</span><button data-del>Delete</button>',
        }[c.status] || '<button data-del>Delete</button>';
      card.innerHTML =
        `<div class="sn-quote">${escapeHtml(c.quotedText.slice(0, 90))}</div>` +
        `<div class="sn-body">${escapeHtml(c.body)}</div>` +
        diffHtml +
        `<div class="sn-actions">${actions}</div>`;

      const on = (sel, fn) =>
        card.querySelector(sel)?.addEventListener('click', async (e) => {
          e.stopPropagation();
          await fn();
          render();
        });
      on('[data-del]', () => api.remove(c.id));
      on('[data-resolve]', () => api.resolve(c.id));
      on('[data-accept]', () => api.accept(c.id));
      on('[data-reject]', () => api.reject(c.id));

      if (block)
        card.addEventListener('click', (e) => {
          if (e.target.tagName === 'BUTTON') return;
          block.scrollIntoView({ behavior: 'smooth', block: 'center' });
          block.classList.add('sn-flash');
          setTimeout(() => block.classList.remove('sn-flash'), 1000);
        });
      list.appendChild(card);
    }
  }

  const escapeHtml = (s) =>
    s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

  render();
})();
