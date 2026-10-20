/* In-page editor: click text to edit, Save commits to GitHub.
   Every editable element is marked in _layouts/page.html:
     data-src="page|settings"  which file a top-level field/list belongs to
     data-f="name"             field name ("_" = the item itself, for string lists)
     data-list="name"          a repeatable list; children with data-item are its entries
     data-link="name"          the element's href is stored in that field (raw value in data-href-raw)
     data-md                   field holds Markdown (links); converted from HTML on save */
(function () {
  'use strict';

  const body = document.body;
  const CFG = {
    repo: body.dataset.repo,
    branch: body.dataset.branch || 'main',
    files: { page: body.dataset.pagePath, settings: body.dataset.settingsPath },
    rev: body.dataset.rev || ''
  };
  if (!CFG.repo || !CFG.files.page) return;

  const TOKEN_KEY = 'pageEditor:' + CFG.repo.toLowerCase() + ':token';
  const YAML_URL = 'https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.0/js-yaml.min.js';
  const API = 'https://api.github.com';

  /* ---------- tiny helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(TOKEN_KEY, v); } catch (e) {} },
    clear() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }
  };
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function b64decode(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.jsyaml) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the YAML library'));
      document.head.appendChild(s);
    });
  }

  /* ---------- GitHub API ---------- */
  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + store.get(),
        'X-GitHub-Api-Version': '2022-11-28',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const err = new Error(data.message || ('GitHub error ' + res.status)); err.status = res.status; throw err; }
    return data;
  }
  const contentsPath = (p) => `/repos/${CFG.repo}/contents/${p.split('/').map(encodeURIComponent).join('/')}`;

  async function readFile(path) {
    const d = await gh(contentsPath(path) + '?ref=' + encodeURIComponent(CFG.branch));
    return { text: b64decode(d.content), sha: d.sha };
  }
  async function writeFile(path, text, sha, message) {
    const d = await gh(contentsPath(path), {
      method: 'PUT',
      body: JSON.stringify({ message, content: b64encode(text), sha, branch: CFG.branch })
    });
    return { sha: d.content.sha, commit: d.commit.sha };
  }

  // Key-order-independent comparison, so unchanged content never creates a commit
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v == null ? '' : v);
  }

  /* ---------- source files ---------- */
  const FM = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;
  function parseSource(kind, text) {
    if (kind === 'page') {
      const m = text.match(FM);
      if (!m) throw new Error('Could not read the page file (no front matter).');
      return { data: jsyaml.load(m[1]) || {}, rest: m[2] || '' };
    }
    return { data: jsyaml.load(text) || {}, rest: '' };
  }
  function buildSource(kind, data, rest) {
    const y = jsyaml.dump(data, { lineWidth: -1, noRefs: true });
    return kind === 'page' ? '---\n' + y + '---\n' + rest : y;
  }

  /* ---------- DOM → data ---------- */
  function htmlToMd(el) {
    let out = '';
    el.childNodes.forEach(n => {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        const tag = n.tagName;
        const inner = htmlToMd(n);
        if (tag === 'A') out += n.getAttribute('href') ? `[${inner}](${n.getAttribute('href')})` : inner;
        else if (tag === 'STRONG' || tag === 'B') out += inner.trim() ? `**${inner}**` : inner;
        else if (tag === 'EM' || tag === 'I') out += inner.trim() ? `*${inner}*` : inner;
        else if (tag === 'BR') out += ' ';
        else out += inner;
      }
    });
    return out;
  }
  const clean = (s) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  function fieldValue(el) { return clean(el.hasAttribute('data-md') ? htmlToMd(el) : el.textContent); }

  const ownerItem = (el) => el.parentElement ? el.parentElement.closest('[data-item]') : null;
  function ownFields(scope) { return $$('[data-f]', scope).filter(el => el.closest('[data-item]') === scope); }
  function ownLinks(scope) { return $$('[data-link]', scope).filter(el => el.closest('[data-item]') === scope); }
  function ownLists(scope) { return $$('[data-list]', scope).filter(el => ownerItem(el) === scope); }

  function readItem(item, list) {
    if (list.hasAttribute('data-strings')) { const f = $('[data-f]', item); return f ? fieldValue(f) : ''; }
    const obj = item.dataset.keep ? JSON.parse(item.dataset.keep) : {};
    ownFields(item).forEach(el => { obj[el.dataset.f] = fieldValue(el); });
    ownLinks(item).forEach(el => { obj[el.dataset.link] = el.dataset.hrefRaw || ''; });
    ownLists(item).forEach(l => { obj[l.dataset.list] = readList(l); });
    return obj;
  }
  function readList(list) { return $$(':scope > [data-item]', list).map(item => readItem(item, list)); }

  function readSource(src) {
    const obj = {};
    $$(`[data-src="${src}"][data-f]`).forEach(el => { obj[el.dataset.f] = fieldValue(el); });
    $$(`[data-src="${src}"][data-link]`).forEach(el => { obj[el.dataset.link] = el.dataset.hrefRaw || ''; });
    $$(`[data-src="${src}"][data-list]`).forEach(l => { obj[l.dataset.list] = readList(l); });
    return obj;
  }

  /* ---------- templates for new list items (match page.html) ---------- */
  const TPL = {
    phases: () => `<li class="step" data-item data-open="true">
        <div class="step-head"><span class="step-num"></span>
          <div class="step-titles"><h3 data-f="title" data-ph="Phase title"></h3><p data-f="summary" data-ph="One-line summary"></p></div>
          <button class="toggle" type="button" aria-expanded="true">View more <span class="chev">▾</span></button></div>
        <div class="step-body"><ol class="substeps" data-list="steps">${TPL.steps()}</ol></div></li>`,
    steps: () => `<li data-item><strong data-f="heading" data-ph="Bold start."></strong> <span data-f="text" data-md data-ph="Rest of the step"></span></li>`,
    cards: () => `<div class="card" data-item><h2 data-f="title" data-ph="Card title"></h2><p data-f="text" data-ph="Card text"></p>
        <a class="btn" href="#" data-link="link" data-href-raw="#"><span data-f="button" data-ph="Button"></span> <span aria-hidden="true">▸</span></a></div>`,
    menu: () => `<li data-item><a href="#" data-f="label" data-link="link" data-href-raw="#" data-ph="Menu item"></a></li>`,
    footer_links: () => TPL.link(),
    footer_small_links: () => TPL.link(),
    link: () => `<li data-item><a href="#" data-f="label" data-link="link" data-href-raw="#" data-ph="Link"></a></li>`,
    breadcrumb: () => `<li data-item><a href="#" data-f="_" data-ph="Breadcrumb"></a></li>`
  };
  const LABEL = { phases: 'phase', steps: 'step', cards: 'card', menu: 'menu item', footer_links: 'link', footer_small_links: 'link', breadcrumb: 'breadcrumb' };

  /* ---------- edit mode UI ---------- */
  let state = null;    // { src: {page:{text,sha,data,rest}, settings:{...}}, dirty, savedCommit }
  let savedCommit = '';
  let popover, bar, savedRange = null;

  function renumber() { $$('#steps > .step').forEach((li, i) => { const n = $('.step-num', li); if (n) n.textContent = i + 1; }); }
  function markDirty() { if (state) { state.dirty = true; setStatus('Unsaved changes'); } }

  function decorateFields(root) {
    $$('[data-f]', root).forEach(el => {
      el.contentEditable = 'true';
      el.spellcheck = true;
    });
  }
  function addControls(item) {
    if ($(':scope > .ed-ctrl', item)) return;
    const list = item.parentElement;
    const inline = list.hasAttribute('data-inline') || list.dataset.list === 'cards';
    const name = LABEL[list.dataset.list] || 'item';
    const c = h(`<span class="ed-ctrl" contenteditable="false">
      <button type="button" data-act="up" title="Move ${name} ${inline ? 'left' : 'up'}">${inline ? '◀' : '▲'}</button>
      <button type="button" data-act="down" title="Move ${name} ${inline ? 'right' : 'down'}">${inline ? '▶' : '▼'}</button>
      <button type="button" data-act="del" title="Remove ${name}">✕</button></span>`);
    item.prepend(c);
  }
  function addAddButton(list) {
    const name = LABEL[list.dataset.list] || 'item';
    const btn = h(`<button type="button" class="ed-add" contenteditable="false" data-act="add">+ Add ${name}</button>`);
    btn._list = list;
    if (list.hasAttribute('data-inline')) { const li = document.createElement('li'); li.className = 'ed-only'; li.appendChild(btn); list.appendChild(li); }
    else list.after(btn);
  }
  function setupList(list) { $$(':scope > [data-item]', list).forEach(addControls); addAddButton(list); }

  function enterEditUI() {
    body.classList.add('editing');
    const notice = $('#notice'); if (notice) notice.hidden = false;
    decorateFields(document);
    $$('[data-list]').forEach(setupList);

    bar = h(`<div class="ed-bar" role="region" aria-label="Page editor">
      <span class="ed-title">✏️ Editing</span>
      <span class="ed-status" aria-live="polite">Click any text to change it</span>
      <button type="button" class="ed-btn ed-primary" data-act="save">Save</button>
      <button type="button" class="ed-btn" data-act="cancel">Cancel</button>
      <button type="button" class="ed-btn ed-quiet" data-act="signout" title="Forget your GitHub token on this browser">Sign out</button></div>`);
    body.appendChild(bar);

    popover = h(`<div class="ed-pop" hidden></div>`);
    body.appendChild(popover);

    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('focusin', onFocus, true);
    document.addEventListener('selectionchange', onSelection);
    window.addEventListener('beforeunload', onUnload);
  }

  function exitEditUI() {
    body.classList.remove('editing');
    $$('[contenteditable]').forEach(el => el.removeAttribute('contenteditable'));
    $$('.ed-ctrl, .ed-add, .ed-only').forEach(el => el.remove());
    if (bar) bar.remove(); if (popover) popover.remove();
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('input', onInput, true);
    document.removeEventListener('paste', onPaste, true);
    document.removeEventListener('focusin', onFocus, true);
    document.removeEventListener('selectionchange', onSelection);
    window.removeEventListener('beforeunload', onUnload);
    const notice = $('#notice');
    if (notice) notice.hidden = !clean($('[data-f="notice"]', notice).textContent);
    state = null;
  }

  function setStatus(msg, kind) {
    const s = bar && $('.ed-status', bar);
    if (!s) return;
    s.textContent = msg;
    s.dataset.kind = kind || '';
  }

  /* ---------- events ---------- */
  function onClick(e) {
    const t = e.target;
    if (t.closest('.ed-pop')) return;
    const act = t.closest('[data-act]');
    if (act) {
      e.preventDefault(); e.stopPropagation();
      const a = act.dataset.act;
      if (a === 'save') return save();
      if (a === 'cancel') return cancel();
      if (a === 'signout') return signOut();
      if (a === 'add') return addItem(act._list);
      const item = act.closest('[data-item]');
      if (a === 'del') {
        const list = item.parentElement;
        const name = LABEL[list.dataset.list] || 'item';
        const label = clean(($('[data-f]', item) || item).textContent).slice(0, 40);
        if (!window.confirm(`Remove this ${name}${label ? ` ("${label}")` : ''}?`)) return;
        item.remove();
      }
      if (a === 'up') { const p = item.previousElementSibling; if (p && p.hasAttribute('data-item')) p.before(item); }
      if (a === 'down') { const n = item.nextElementSibling; if (n && n.hasAttribute('data-item')) n.after(item); }
      renumber(); markDirty();
      return;
    }
    // Never follow links while editing
    const link = t.closest('a');
    if (link) e.preventDefault();
    if (t.closest('.toggle')) e.preventDefault();
    // Clicking a link inside a Markdown field → edit that link
    const md = t.closest('[data-md]');
    if (md && link && md.contains(link)) showInlineLinkEditor(link);
  }

  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
    if (e.key === 'Escape' && popover && !popover.hidden) { hidePopover(); return; }
    const f = e.target.closest && e.target.closest('[data-f]');
    if (f && e.key === 'Enter') { e.preventDefault(); f.blur(); }
  }
  function onInput(e) { if (e.target.closest && e.target.closest('[data-f]')) markDirty(); }
  function onPaste(e) {
    const f = e.target.closest && e.target.closest('[data-f]');
    if (!f) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain').replace(/\s+/g, ' ');
    document.execCommand('insertText', false, text);
  }
  function onUnload(e) { if (state && state.dirty) { e.preventDefault(); e.returnValue = ''; } }

  function onFocus(e) {
    const t = e.target;
    if (!t.closest || t.closest('.ed-pop')) return;
    const linkEl = t.closest('[data-link]');
    if (linkEl) return showHrefEditor(linkEl);
    const md = t.closest('[data-md]');
    if (md) return showMdTools(md);
    hidePopover();
  }
  function onSelection() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return;
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const md = node && node.closest && node.closest('[data-md]');
    if (md && body.classList.contains('editing')) savedRange = sel.getRangeAt(0).cloneRange();
  }

  /* ---------- popovers ---------- */
  function placePopover(anchor) {
    const r = anchor.getBoundingClientRect();
    popover.hidden = false;
    const w = popover.offsetWidth;
    const left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8));
    popover.style.left = left + 'px';
    popover.style.top = (window.scrollY + r.bottom + 6) + 'px';
  }
  function hidePopover() { if (popover) { popover.hidden = true; popover.innerHTML = ''; } }

  function showHrefEditor(el) {
    popover.innerHTML = `<label>Link goes to <input type="text" value="${esc(el.dataset.hrefRaw || '')}" placeholder="https://… or /page/ or #"></label>`;
    const input = $('input', popover);
    input.addEventListener('input', () => { el.dataset.hrefRaw = input.value.trim(); markDirty(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); hidePopover(); } });
    placePopover(el);
  }

  function showMdTools(md) {
    popover.innerHTML = `<button type="button" class="ed-btn" data-pop="link">🔗 Make selected text a link</button>`;
    const btn = $('button', popover);
    btn.addEventListener('mousedown', e => e.preventDefault()); // keep the text selection
    btn.addEventListener('click', () => {
      const range = savedRange;
      if (!range || range.collapsed || !md.contains(range.commonAncestorContainer)) {
        btn.textContent = 'Select some text in this step first';
        return;
      }
      popover.innerHTML = `<label>Link to <input type="text" placeholder="https://…"></label> <button type="button" class="ed-btn ed-primary">Add</button>`;
      const input = $('input', popover);
      const apply = () => {
        const url = input.value.trim();
        if (!url) return hidePopover();
        const a = document.createElement('a');
        a.href = url;
        try { range.surroundContents(a); } catch (err) { a.appendChild(range.extractContents()); range.insertNode(a); }
        markDirty(); hidePopover();
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
      $('button', popover).addEventListener('click', apply);
      placePopover(md); input.focus();
    });
    placePopover(md);
  }

  function showInlineLinkEditor(a) {
    popover.innerHTML = `<label>Link goes to <input type="text" value="${esc(a.getAttribute('href') || '')}"></label> <button type="button" class="ed-btn" data-pop="unlink">Remove link</button>`;
    const input = $('input', popover);
    input.addEventListener('input', () => { a.setAttribute('href', input.value.trim()); markDirty(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); hidePopover(); } });
    $('[data-pop="unlink"]', popover).addEventListener('click', () => { a.replaceWith(...a.childNodes); markDirty(); hidePopover(); });
    placePopover(a);
  }

  /* ---------- list editing ---------- */
  function addItem(list) {
    const make = TPL[list.dataset.list];
    if (!make) return;
    const item = h(make());
    const addLi = $(':scope > .ed-only', list);
    if (addLi) addLi.before(item); else list.appendChild(item);
    decorateFields(item);
    addControls(item);
    $$('[data-list]', item).forEach(setupList);
    renumber(); markDirty();
    const first = $('[data-f]', item);
    if (first) first.focus();
  }

  /* ---------- modals ---------- */
  function modal(html) {
    return new Promise(resolve => {
      const m = h(`<div class="ed-modal" role="dialog" aria-modal="true"><div class="ed-card">${html}</div></div>`);
      body.appendChild(m);
      const done = (v) => { m.remove(); resolve(v); };
      m.addEventListener('click', e => {
        const b = e.target.closest('[data-m]');
        if (b) done(b.dataset.m === 'ok' ? ($('input', m) ? $('input', m).value.trim() : true) : null);
      });
      m.addEventListener('keydown', e => {
        if (e.key === 'Escape') done(null);
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); done(e.target.value.trim()); }
      });
      const input = $('input', m); (input || $('[data-m="ok"]', m)).focus();
    });
  }

  async function askToken(errorMsg) {
    const repoName = CFG.repo.split('/')[1];
    const v = await modal(`
      <h2>Connect to GitHub to edit</h2>
      ${errorMsg ? `<p class="ed-error">${esc(errorMsg)}</p>` : ''}
      <p>This is a one-time step on this browser. Your changes are saved to GitHub under your account.</p>
      <ol>
        <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → New fine-grained token</a> (sign in if asked).</li>
        <li>Name it anything, e.g. <em>Website editor</em>. Pick an expiry date.</li>
        <li><strong>Repository access:</strong> “Only select repositories” → <strong>${esc(repoName)}</strong>.</li>
        <li><strong>Permissions → Repository permissions → Contents:</strong> “Read and write”.</li>
        <li>Click <strong>Generate token</strong>, copy it, and paste it below.</li>
      </ol>
      <input type="password" autocomplete="off" placeholder="github_pat_…" aria-label="GitHub token">
      <div class="ed-actions"><button type="button" class="ed-btn" data-m="cancel">Cancel</button><button type="button" class="ed-btn ed-primary" data-m="ok">Connect</button></div>`);
    if (v) store.set(v);
    return !!v;
  }

  /* ---------- start / save / cancel ---------- */
  async function start() {
    const startBtn = $('#ed-start');
    if (!store.get() && !(await askToken())) return;
    startBtn.disabled = true; startBtn.textContent = 'Loading…';
    try {
      await loadScript(YAML_URL);
      const src = {};
      for (const kind of ['page', 'settings']) {
        const f = await readFile(CFG.files[kind]);
        src[kind] = { ...f, ...parseSource(kind, f.text) };
      }
      // Guard: is this page showing the latest saved version?
      if (CFG.rev) {
        const latest = await gh(`/repos/${CFG.repo}/commits/${encodeURIComponent(CFG.branch)}`);
        if (latest.sha !== CFG.rev && latest.sha !== savedCommit) {
          const go = await modal(`<h2>A newer version was saved</h2>
            <p>Someone saved changes after this page was built, so you might be looking at old text. Editing now could undo their changes.</p>
            <p>Wait about a minute for the site to update, then reload.</p>
            <div class="ed-actions"><button type="button" class="ed-btn" data-m="cancel">Edit anyway</button><button type="button" class="ed-btn ed-primary" data-m="ok">Reload</button></div>`);
          if (go) { location.reload(); return; }
        }
      }
      state = { src, dirty: false };
      startBtn.hidden = true;
      enterEditUI();
    } catch (err) {
      if (err.status === 401 || err.status === 403 || err.status === 404) {
        store.clear();
        if (await askToken(err.status === 401 ? 'That token was not accepted. It may have expired or been copied wrong.' : 'That token cannot access this repository. Check “Repository access” and “Contents” permission.')) {
          startBtn.disabled = false; startBtn.textContent = '✏️ Edit page';
          return start();
        }
      } else {
        await modal(`<h2>Couldn’t start editing</h2><p class="ed-error">${esc(err.message)}</p><div class="ed-actions"><button type="button" class="ed-btn ed-primary" data-m="ok">OK</button></div>`);
      }
    } finally {
      startBtn.disabled = false; startBtn.textContent = '✏️ Edit page';
    }
  }

  async function save() {
    if (!state || state.saving) return;
    hidePopover();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    state.saving = true;
    setStatus('Saving…');
    const pageTitle = clean(($('[data-src="page"][data-f="title"]') || {}).textContent || 'page');
    try {
      let changed = 0;
      for (const kind of ['page', 'settings']) {
        const s = state.src[kind];
        const data = { ...s.data, ...readSource(kind) };
        if (stable(data) === stable(s.data)) continue;
        const text = buildSource(kind, data, s.rest);
        const msg = kind === 'page' ? `Edit "${pageTitle}" from the website` : 'Edit site settings from the website';
        const r = await writeFile(CFG.files[kind], text, s.sha, msg);
        Object.assign(s, { text, sha: r.sha, data });
        savedCommit = r.commit;
        changed++;
      }
      state.dirty = false;
      setStatus(changed ? 'Saved ✓ The live site updates in about a minute.' : 'No changes to save', 'ok');
      if (changed) setTimeout(() => { if (state && !state.dirty) { exitEditUI(); $('#ed-start').hidden = false; } }, 2500);
    } catch (err) {
      setStatus(err.status === 409 ? 'Someone else saved in the meantime. Copy your text, reload, and try again.' : 'Save failed: ' + err.message, 'error');
    } finally {
      if (state) state.saving = false;
    }
  }

  async function cancel() {
    if (state && state.dirty) {
      const ok = await modal(`<h2>Discard your changes?</h2><p>Anything you haven’t saved will be lost.</p>
        <div class="ed-actions"><button type="button" class="ed-btn" data-m="cancel">Keep editing</button><button type="button" class="ed-btn ed-primary" data-m="ok">Discard</button></div>`);
      if (!ok) return;
      state.dirty = false;
    }
    location.reload();
  }

  async function signOut() {
    if (state && state.dirty) { setStatus('Save or cancel your changes first', 'error'); return; }
    store.clear();
    location.reload();
  }

  /* ---------- show the Edit button for editors ---------- */
  const startBtn = $('#ed-start');
  if (!startBtn) return;
  function maybeShow() { if (store.get() || /^#edit$/i.test(location.hash)) startBtn.hidden = false; }
  maybeShow();
  window.addEventListener('hashchange', maybeShow);
  startBtn.addEventListener('click', start);

  // Expose internals for testing
  window.__pageEditor = { readSource, htmlToMd, buildSource, parseSource };
})();
