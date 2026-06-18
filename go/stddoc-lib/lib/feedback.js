/*
 * std-doc feedback widget
 * Copyright (c) 2026 goldenDragon7 — MIT License (see LICENSE).
 *
 * Built on make-pages-interactive by Paras Chopra (MIT):
 *   https://github.com/paraschopra/make-pages-interactive
 * Forked from his proven core (snapshot-on-selection, the multi-tier anchor
 * fallback, the liveness-aware stale timer) and grown from there. His MIT
 * copyright and permission notice are reproduced in the NOTICE file.
 */
/*
 * Claude Feedback — drop-in in-page review library.
 *
 * Two modes for attaching a comment to a region of the page:
 *
 *   (1) Text-selection mode (always on): highlight any text. A "💬 comment"
 *       pill appears below the selection. Click it to open the editor.
 *
 *   (2) Element-selection mode (toggle): click the "select element" button in
 *       the panel. Hover any commentable element (images, tables, figures,
 *       paragraphs, sections, list items) to outline it. Click to select.
 *       Shift-click to add more elements to the selection. A floating popup
 *       gives you "comment" and "clear" buttons. Press Esc or toggle off to exit.
 *
 *   (3) General questions: "+ general" in the panel adds a comment that isn't
 *       tied to any region.
 *
 * Each comment carries rich anchor info so the agent can find the exact
 * region later: stable CSS selector, auto-assigned data-cf-id, element tag,
 * text snippet, and truncated outerHTML.
 *
 * The page polls feedback/history.json. New entries appear as inline
 * highlights and in the History tab; the agent attaches data-cf-change="ch-N"
 * markers in the HTML which the library uses for the "tour" walkthrough.
 */
(function () {
  if (window.__claudeFeedbackInit) return;
  window.__claudeFeedbackInit = true;

  // ---------------- Constants ----------------
  const LS_KEY = "cf-state-v1";
  // Endpoints default to the standalone engine server, but a host page may
  // override them (e.g. when the doc is served under a larger app like the
  // Knowledge Library) by setting window.__cfHistoryUrl / window.__cfFeedbackUrl
  // before this script loads. Defaults preserve the original behaviour.
  const HISTORY_URL = window.__cfHistoryUrl || "feedback/history.json";
  const FEEDBACK_URL = window.__cfFeedbackUrl || "/feedback";
  // Presence heartbeat written by `stddoc serve`. A FRESH beat means
  // an agent is home — drives the "watching / on it" indicator and suppresses
  // the false "nobody is watching" warning. Absent file → no presence shown.
  const WATCHER_URL = window.__cfWatcherUrl || "feedback/watcher.json";
  const WATCHER_FRESH_MS = 15000;   // a heartbeat older than this = cold
  const POLL_INTERVAL_MS = 4000;
  const OUTER_HTML_MAX = 600;
  const TEXT_SNIPPET_MAX = 220;

  // Selectors that we consider "commentable" — i.e. you can click them in
  // element-selection mode. Anything that's a meaningful block of content.
  const COMMENTABLE_TAGS = new Set([
    "P", "H1", "H2", "H3", "H4", "H5", "H6",
    "UL", "OL", "LI", "DL",
    "TABLE", "TR",
    "FIGURE", "IMG", "SVG", "CANVAS", "VIDEO",
    "BLOCKQUOTE", "PRE",
    "SECTION", "ARTICLE",
  ]);
  const COMMENTABLE_CLASSES = new Set(["card", "tldr", "fig", "controls"]);

  // ---------------- State ----------------
  // One state object, grouped by concern, so the reload state machine is
  // legible in one place (R3). Every render*/save* threads S; nothing here is a
  // module-level global anymore. Constants (timeouts, the page URL) stay const
  // beside it — they are configuration, not state.
  const S = {
    // Queue + submitted-batch (persisted to localStorage via saveLS/loadLS).
    pending: [],                 // comments queued but not yet POSTed
    lastSubmittedBatch: null,    // { comment_ids, submitted_at, pending_snapshot } — survives reloads

    // History + polling.
    history: [],                 // parsed feedback/history.json
    lastHistoryString: "",       // raw last fetch, to skip no-op re-renders
    pollTimer: null,
    isFirstHistoryFetch: true,   // the first fetch establishes a SILENT baseline
    knownChangeIds: new Set(),   // a change is "new" only if it appears after the first fetch

    // Selection / element / tour modes.
    savedTextSelection: null,    // {range, quote, anchor} snapshotted at popup time
    elementMode: false,
    selectedElements: [],        // ordered, element-mode selection
    tourState: null,

    // Staleness ("nobody picked this up") — pushed back on proof-of-life.
    staleTimer: null,
    isBatchStale: false,

    // "Changes ready, reload to see" + cancelable auto-reload.
    originalTitle: "",
    pendingReload: false,
    pendingReloadCount: 0,
    autoReloadTimer: null,
    autoReloadPaused: false,

    // Content-change detection (board regen, separate from a feedback change).
    lastPageModified: null,      // baseline page Last-Modified; null = none yet / never fire

    // Presence — last heartbeat read from watcher.json (null = none/cold).
    watcherBeat: null,           // { status, ts(epoch s), note } or null
  };

  // Longer than the raw "first-network-roundtrip" timeout — most real agent
  // edits involve multiple tool calls (read, edit, append history, rebuild)
  // and can easily take 30–60s. We also push this timer back whenever
  // history.json content changes (any change is proof of life from the
  // agent), so the deadline only fires if the file is genuinely untouched.
  const STALE_AFTER_MS = 90000;

  // Auto-reload: when truly-new changes arrive, reload the board in front of the
  // reader after a short, CANCELABLE delay instead of waiting for them to press
  // R. Suppressed while they're mid-comment, and pausable from the banner.
  const AUTO_RELOAD_DELAY_MS = 1500;

  // We probe the page's own Last-Modified (HEAD on the current path) each poll
  // and, when it advances past the baseline recorded on load, trigger the same
  // auto-reload.
  const PAGE_VERSION_URL = location.pathname;

  function watcherAlive() {
    return !!(S.watcherBeat && (Date.now() - S.watcherBeat.ts * 1000) < WATCHER_FRESH_MS);
  }

  // ---------------- LocalStorage ----------------
  function loadLS() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
  }
  function saveLS() {
    const cur = loadLS();
    cur.pending = S.pending;
    cur.lastSubmittedBatch = S.lastSubmittedBatch;
    localStorage.setItem(LS_KEY, JSON.stringify(cur));
  }

  // ---------------- Anchors ----------------
  function assignAnchors() {
    let n = 0;
    document.querySelectorAll("body *").forEach((el) => {
      if (insideOurUI(el)) return;
      if (el.dataset.cfId) return;
      if (!isCommentable(el)) return;
      el.dataset.cfId = "el-" + (++n);
    });
  }

  function isCommentable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (insideOurUI(el)) return false;
    if (COMMENTABLE_TAGS.has(el.tagName)) return true;
    for (const c of el.classList) if (COMMENTABLE_CLASSES.has(c)) return true;
    // Also consider any element with an id (likely a meaningful section)
    if (el.id && el.id.length > 0 && !el.id.startsWith("cf-")) return true;
    return false;
  }

  function findCommentableAncestor(node) {
    let el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body && el !== document.documentElement) {
      if (insideOurUI(el)) return null;
      if (el.dataset && el.dataset.cfId) return el;
      if (isCommentable(el)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function insideOurUI(el) {
    if (!el || !el.closest) return false;
    return !!el.closest("#claude-feedback-root, .cf-editor, .cf-selection-popup, .cf-tour-bar, .cf-toast");
  }

  function stableSelector(el) {
    if (!el) return "";
    if (el.id) return "#" + CSS.escape(el.id);
    if (el.dataset && el.dataset.cfId) return '[data-cf-id="' + el.dataset.cfId + '"]';
    // walk up for an id or data-cf-id
    let cur = el.parentElement;
    let suffix = " > " + el.tagName.toLowerCase();
    let path = el.tagName.toLowerCase();
    while (cur && cur !== document.body) {
      if (cur.id) return "#" + CSS.escape(cur.id) + " " + path;
      if (cur.dataset && cur.dataset.cfId) return '[data-cf-id="' + cur.dataset.cfId + '"] ' + path;
      const idx = Array.prototype.indexOf.call(cur.children, el) + 1;
      path = cur.tagName.toLowerCase() + ":nth-child(" + idx + ") > " + path;
      el = cur;
      cur = cur.parentElement;
    }
    return path;
  }

  function anchorInfo(el) {
    if (!el) return null;
    return {
      cf_id: el.dataset.cfId || null,
      selector: stableSelector(el),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      text_snippet: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, TEXT_SNIPPET_MAX),
      outer_html: truncate(el.outerHTML, OUTER_HTML_MAX),
    };
  }

  function truncate(s, n) {
    if (!s) return "";
    if (s.length <= n) return s;
    return s.slice(0, n) + "…";
  }

  // ---------------- UI: build DOM ----------------
  // Heading for the first-class "general feedback" widget. The engine ships
  // system-wide so the default is neutral, but a specific doc can label it via
  // window.__cfWhisperHeading or a data-cf-whisper-heading attribute on <body>
  // or <html> (e.g. set it to "Notes for the author").
  function whisperHeading() {
    return (
      window.__cfWhisperHeading ||
      document.body.getAttribute("data-cf-whisper-heading") ||
      document.documentElement.getAttribute("data-cf-whisper-heading") ||
      "Message the author"
    );
  }

  function buildUI() {
    const root = document.createElement("div");
    root.id = "claude-feedback-root";
    root.innerHTML = [
      '<div class="cf-launcher">',
      '  <button id="cf-toggle" class="cf-btn-primary" title="Feedback (press F)">',
      '    <span>feedback</span> <span class="cf-kbd-hint">F</span> <span id="cf-badge"></span>',
      '  </button>',
      '</div>',
      '<div id="cf-panel" class="cf-panel" aria-hidden="true">',
      '  <div class="cf-panel-header">',
      '    <strong>Feedback</strong>',
      '    <span class="cf-header-hint">F · P · H · T · ? · Esc</span>',
      '    <button id="cf-close" class="cf-icon-btn" aria-label="Close">×</button>',
      '  </div>',
      '  <div class="cf-tabs">',
      '    <button data-tab="pending" class="cf-tab cf-tab-active" title="Pending (P)">Pending <span class="cf-kbd-hint">P</span></button>',
      '    <button data-tab="history" class="cf-tab" title="History (H)">History <span class="cf-kbd-hint">H</span></button>',
      '  </div>',
      '  <div id="cf-tab-pending" class="cf-tab-pane cf-tab-pane-active">',
      '    <div id="cf-pending-list" class="cf-list"></div>',
      '    <div class="cf-panel-actions">',
      '      <button id="cf-elem-toggle" class="cf-btn">🎯 select element</button>',
      '      <button id="cf-add-general" class="cf-btn">+ general</button>',
      '    </div>',
      '    <div class="cf-panel-actions" style="margin-top:6px;">',
      '      <button id="cf-submit" class="cf-btn-primary" disabled>submit batch</button>',
      '    </div>',
      '    <p class="cf-hint">Highlight any text to comment on it. Or click <em>select element</em>, then click any block on the page (image, table, paragraph, section). Shift-click to add more elements. Esc cancels.</p>',
      '  </div>',
      '  <div id="cf-tab-history" class="cf-tab-pane">',
      '    <div id="cf-history-list" class="cf-list"></div>',
      '    <div class="cf-panel-actions">',
      '      <button id="cf-tour" class="cf-btn" disabled title="Start tour (T)">start tour <span class="cf-kbd-hint">T</span></button>',
      '    </div>',
      '  </div>',
      '</div>',
      // text-selection popup
      '<div id="cf-selection-popup" class="cf-selection-popup">',
      '  <button id="cf-popup-comment" class="cf-btn-primary cf-btn-small">💬 comment <kbd class="cf-kbd-hint">C</kbd></button>',
      '</div>',
      // element-selection popup
      '<div id="cf-elem-popup" class="cf-selection-popup">',
      '  <button id="cf-elem-popup-comment" class="cf-btn-primary cf-btn-small">💬 comment</button>',
      '  <button id="cf-elem-popup-clear"   class="cf-btn cf-btn-small">clear</button>',
      '</div>',
      // editor
      '<div id="cf-editor" class="cf-editor" role="dialog" aria-label="Comment editor">',
      '  <div class="cf-editor-quote" id="cf-editor-quote"></div>',
      '  <textarea id="cf-editor-text" placeholder="your comment or question…" rows="3"></textarea>',
      '  <div class="cf-editor-actions">',
      '    <button id="cf-editor-cancel" class="cf-btn cf-btn-small">cancel</button>',
      '    <button id="cf-editor-save" class="cf-btn-primary cf-btn-small">add (⌘↵)</button>',
      '  </div>',
      '</div>',
      // tour bar
      '<div id="cf-tour-bar" class="cf-tour-bar">',
      '  <button id="cf-tour-prev" class="cf-btn cf-btn-small" title="Prev (←)">← prev</button>',
      '  <span id="cf-tour-label" class="cf-tour-label"></span>',
      '  <button id="cf-tour-next" class="cf-btn cf-btn-small" title="Next (→)">next →</button>',
      '  <button id="cf-tour-exit" class="cf-btn cf-btn-small" title="Exit (Esc)">exit</button>',
      '</div>',
      '<div id="cf-toast" class="cf-toast"></div>',
      // "Changes ready, reload to see" banner — persistent, top-center
      '<div id="cf-reload-banner" class="cf-reload-banner" role="status" aria-live="polite">',
      '  <span class="cf-reload-bell" aria-hidden="true">🔔</span>',
      '  <span id="cf-reload-msg" class="cf-reload-msg">Changes ready, reload to see</span>',
      '  <button id="cf-reload-now" class="cf-btn-primary cf-btn-small" title="Reload (R)">reload <span class="cf-kbd-hint">R</span></button>',
      '  <button id="cf-reload-pause" class="cf-btn cf-btn-small" title="Pause auto-reload">pause auto</button>',
      '</div>'
    ].join("");
    document.body.appendChild(root);

    // First-class general-feedback widget — a persistent compose box that lives
    // INLINE in the document flow (NOT a floating overlay) so you can talk to
    // the author WITHOUT selecting any text. Sends through the exact same path
    // as the panel batch (→ inbox.jsonl). Mount point preference: an explicit
    // #cf-whisper-mount, else the main content container, else <body>, so the
    // box appears as a block at the END of the document content.
    const whisperWrap = document.createElement("div");
    whisperWrap.innerHTML = [
      '<div id="cf-whisper" class="cf-whisper">',
      '  <div class="cf-whisper-head" id="cf-whisper-head">' + escapeHtml(whisperHeading()) + '</div>',
      '  <textarea id="cf-whisper-text" class="cf-whisper-text" rows="2" placeholder="Type a note — no need to select anything. ⌘↵ to queue."></textarea>',
      '  <div class="cf-whisper-actions">',
      '    <button id="cf-whisper-send" class="cf-btn-primary cf-btn-small" disabled>queue</button>',
      '  </div>',
      '</div>'
    ].join("");
    const whisper = whisperWrap.firstElementChild;
    const whisperMount =
      document.getElementById("cf-whisper-mount") ||
      document.querySelector("main") ||
      document.querySelector(".content") ||
      document.querySelector("article") ||
      document.querySelector("section") ||
      document.body;
    whisperMount.appendChild(whisper);
  }

  const $ = (id) => document.getElementById(id);

  function showToast(msg, ms = 2500) {
    const t = $("cf-toast");
    t.textContent = msg;
    t.classList.add("cf-visible");
    clearTimeout(t._timeout);
    t._timeout = setTimeout(() => t.classList.remove("cf-visible"), ms);
  }

  // ---------------- Text selection ----------------
  function onSelectionChange() {
    if (S.elementMode) { hideTextPopup(); return; }
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hideTextPopup(); return; }
    const txt = sel.toString().trim();
    if (txt.length < 2) { hideTextPopup(); return; }
    const node = sel.anchorNode;
    if (node && insideOurUI(node.nodeType === 3 ? node.parentElement : node)) {
      hideTextPopup();
      return;
    }
    showTextPopup(sel);
  }

  function showTextPopup(selection) {
    const popup = $("cf-selection-popup");
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    popup.style.top = (window.scrollY + rect.bottom + 6) + "px";
    popup.style.left = (window.scrollX + rect.left + rect.width / 2 - 50) + "px";
    popup.classList.add("cf-visible");
    // SNAPSHOT the relevant state immediately — don't rely on live selection later
    const anchorEl = findCommentableAncestor(range.startContainer);
    S.savedTextSelection = {
      range: range.cloneRange(),
      quote: selection.toString().trim(),
      anchor: anchorInfo(anchorEl),
    };
  }

  function hideTextPopup() {
    $("cf-selection-popup").classList.remove("cf-visible");
  }

  // ---------------- Element selection ----------------
  function toggleElementMode() {
    S.elementMode = !S.elementMode;
    document.body.classList.toggle("cf-elem-mode", S.elementMode);
    const btn = $("cf-elem-toggle");
    btn.classList.toggle("cf-active", S.elementMode);
    btn.textContent = S.elementMode ? "✓ element mode (on)" : "🎯 select element";
    if (!S.elementMode) {
      clearElementSelection();
      hideElemPopup();
    } else {
      hideTextPopup();
      showToast("Click anything (image, table, paragraph). Shift-click adds. Esc exits.", 3500);
    }
  }

  function clearElementSelection() {
    S.selectedElements.forEach(el => el.classList.remove("cf-elem-selected"));
    S.selectedElements = [];
    document.querySelectorAll(".cf-elem-hover").forEach(el => el.classList.remove("cf-elem-hover"));
  }

  function onElemMouseOver(e) {
    if (!S.elementMode) return;
    if (insideOurUI(e.target)) return;
    const el = findCommentableAncestor(e.target);
    document.querySelectorAll(".cf-elem-hover").forEach(x => x.classList.remove("cf-elem-hover"));
    if (el && !S.selectedElements.includes(el)) el.classList.add("cf-elem-hover");
  }

  function onElemMouseOut(e) {
    if (!S.elementMode) return;
    if (insideOurUI(e.target)) return;
    document.querySelectorAll(".cf-elem-hover").forEach(x => x.classList.remove("cf-elem-hover"));
  }

  function onElemClick(e) {
    if (!S.elementMode) return;
    if (insideOurUI(e.target)) return;
    const el = findCommentableAncestor(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.shiftKey) {
      // single select: clear others
      S.selectedElements.forEach(x => { if (x !== el) x.classList.remove("cf-elem-selected"); });
      S.selectedElements = [];
    }
    const idx = S.selectedElements.indexOf(el);
    if (idx === -1) {
      S.selectedElements.push(el);
      el.classList.add("cf-elem-selected");
      el.classList.remove("cf-elem-hover");
    } else {
      S.selectedElements.splice(idx, 1);
      el.classList.remove("cf-elem-selected");
    }
    if (S.selectedElements.length > 0) {
      showElemPopup(S.selectedElements[S.selectedElements.length - 1]);
    } else {
      hideElemPopup();
    }
  }

  function showElemPopup(nearEl) {
    const popup = $("cf-elem-popup");
    const r = nearEl.getBoundingClientRect();
    popup.style.top = (window.scrollY + r.bottom + 6) + "px";
    popup.style.left = (window.scrollX + r.left + Math.min(r.width / 2, 120)) + "px";
    popup.classList.add("cf-visible");
  }
  function hideElemPopup() {
    $("cf-elem-popup").classList.remove("cf-visible");
  }

  // ---------------- Comment editor ----------------
  function openTextCommentEditor() {
    if (!S.savedTextSelection) return;
    const editor = $("cf-editor");
    const quoteEl = $("cf-editor-quote");
    quoteEl.classList.remove("cf-comment-general");
    quoteEl.textContent = '"' + S.savedTextSelection.quote + '"';
    editor._payload = {
      type: "selection",
      comment: "",
      quote: S.savedTextSelection.quote,
      anchor: S.savedTextSelection.anchor,
    };
    positionEditor(S.savedTextSelection.range.getBoundingClientRect());
    editor.classList.add("cf-visible");
    hideTextPopup();
    setTimeout(() => $("cf-editor-text").focus(), 50);
  }

  function openElementCommentEditor() {
    if (S.selectedElements.length === 0) return;
    const editor = $("cf-editor");
    const quoteEl = $("cf-editor-quote");
    quoteEl.classList.remove("cf-comment-general");
    const elements = S.selectedElements.map(el => anchorInfo(el));
    // Build a compact summary for the quote display
    quoteEl.innerHTML = elements.map(e => `<div>${escapeHtml(e.tag)}${e.id ? "#" + escapeHtml(e.id) : ""}${e.cf_id ? " <span style='opacity:0.5'>(" + e.cf_id + ")</span>" : ""} — <span style="opacity:0.7">${escapeHtml(e.text_snippet.slice(0, 80))}${e.text_snippet.length > 80 ? "…" : ""}</span></div>`).join("");
    editor._payload = {
      type: "elements",
      comment: "",
      elements,
    };
    positionEditor(S.selectedElements[S.selectedElements.length - 1].getBoundingClientRect());
    editor.classList.add("cf-visible");
    hideElemPopup();
    setTimeout(() => $("cf-editor-text").focus(), 50);
  }

  function openGeneralEditor() {
    const editor = $("cf-editor");
    const quoteEl = $("cf-editor-quote");
    quoteEl.classList.add("cf-comment-general");
    quoteEl.textContent = "General question";
    editor._payload = { type: "general", comment: "" };
    // The editor is position: fixed → viewport coords, NO scrollY
    editor.style.top = Math.max(12, window.innerHeight / 2 - 100) + "px";
    editor.style.left = Math.max(12, window.innerWidth / 2 - 160) + "px";
    editor.classList.add("cf-visible");
    setTimeout(() => $("cf-editor-text").focus(), 50);
  }

  function positionEditor(rect) {
    // CRITICAL: .cf-editor is position:fixed → coords are VIEWPORT coords, no scroll offset.
    const editor = $("cf-editor");
    const width = 320;
    const estimatedHeight = 200;
    let top = rect.bottom + 12;
    // If that pushes the editor off the bottom, flip above the selection
    if (top + estimatedHeight > window.innerHeight - 12) {
      top = rect.top - estimatedHeight - 12;
    }
    top = Math.max(12, Math.min(top, window.innerHeight - estimatedHeight - 12));
    let left = rect.left + Math.min(rect.width / 2, 200) - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    editor.style.top = top + "px";
    editor.style.left = left + "px";
  }

  function closeEditor() {
    const editor = $("cf-editor");
    editor.classList.remove("cf-visible");
    $("cf-editor-text").value = "";
    editor._payload = null;
    // If changes arrived while they were mid-comment, the auto-reload was held;
    // now that the editor is closed it can resume.
    scheduleAutoReload();
  }

  function saveEditorComment() {
    const editor = $("cf-editor");
    const text = $("cf-editor-text").value.trim();
    if (!text || !editor._payload) return;
    const payload = editor._payload;
    payload.id = "c-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6);
    payload.comment = text;
    payload.created_at = new Date().toISOString();
    S.pending.push(payload);
    saveLS();
    renderPending();
    closeEditor();
    // Exit element mode after committing (less surprising than staying in)
    if (payload.type === "elements") {
      clearElementSelection();
      if (S.elementMode) toggleElementMode();
    } else if (payload.type === "selection") {
      window.getSelection().removeAllRanges();
      S.savedTextSelection = null;
    }
    openPanel();
    setActiveTab("pending");
    showToast("comment added");
  }

  // ---------------- Pending list ----------------
  // The set of OUR comment ids that history.json has answered — a comment is
  // answered the moment any history change names it in `in_response_to`. Lets a
  // partial reply show per-comment status instead of clearing the whole banner.
  function answeredIds() {
    const ids = new Set();
    for (const batch of (S.history || [])) {
      for (const ch of (batch.changes || [])) {
        for (const id of (ch.in_response_to || [])) ids.add(id);
      }
    }
    return ids;
  }

  // One per-comment status chip: ✓ answered (green) or ⏳ awaiting (dim).
  function answerChip(done) {
    return done
      ? '<span style="flex:none;font-size:11px;font-weight:700;color:#1f7d4d;background:rgba(52,211,153,.16);border:1px solid rgba(52,211,153,.4);border-radius:99px;padding:1px 7px">✓ answered</span>'
      : '<span style="flex:none;font-size:11px;font-weight:700;color:#9a7b1a;background:rgba(251,191,36,.14);border:1px solid rgba(251,191,36,.4);border-radius:99px;padding:1px 7px">⏳ awaiting</span>';
  }

  function renderPending() {
    const list = $("cf-pending-list");
    list.innerHTML = "";

    // Show a "Claude is processing…" banner while we wait for the agent to
    // respond to the most recent batch. Cleared when history.json has an
    // in_response_to matching any of our submitted comment ids.
    if (S.lastSubmittedBatch) {
      const banner = document.createElement("div");
      banner.className = "cf-processing-banner" + (S.isBatchStale ? " cf-processing-stale" : "");
      const submittedAgo = relTime(S.lastSubmittedBatch.submitted_at);
      const n = S.lastSubmittedBatch.comment_ids.length;
      const _ans = answeredIds();
      const ansN = S.lastSubmittedBatch.comment_ids.filter(id => _ans.has(id)).length;
      // "3 of 4 answered" / "all 4 answered" — so a partial reply is visible.
      const answeredMeta = ansN === n
        ? `all ${n} answered ✓`
        : `${ansN} of ${n} answered · ${n - ansN} awaiting`;
      const submittedList = S.lastSubmittedBatch.pending_snapshot.map(c =>
        `<div class="cf-comment-quote" style="margin-top:4px; display:flex; gap:8px; align-items:flex-start;">${answerChip(_ans.has(c.id))}<span>${escapeHtml(c.comment)}</span></div>`
      ).join("");

      if (S.isBatchStale) {
        // The batch crossed the staleness deadline — but a watcher may have come
        // alive since. Tell the truth about the CURRENT state instead of always
        // asserting "no agent watching" (which is false when a heartbeat is live).
        const live = watcherAlive();
        const staleHead = live
          ? "Still waiting — an agent is watching"
          : "No agent picked this up yet";
        const staleStatus = live
          ? `Your batch is saved in <code>feedback/inbox.jsonl</code> and a Claude Code session <strong>is</strong> watching this directory — it just hasn't applied your edits yet. Give it a moment, or ask it to <em>"process pending feedback in this directory"</em> if it seems stuck.`
          : `Your batch is saved in <code>feedback/inbox.jsonl</code> but no Claude Code session appears to be watching this directory. To process it: open a terminal here, run <code>claude</code>, and ask it to <em>"process pending feedback in this directory"</em>. Claude will scan the inbox and pick up your comments.`;
        banner.innerHTML = `
          <div class="cf-processing-row">
            <div class="cf-stale-icon" aria-hidden="true">⚠</div>
            <div class="cf-processing-body">
              <strong>${staleHead}</strong>
              <span class="cf-processing-meta">${answeredMeta} · submitted ${submittedAgo}</span>
            </div>
          </div>
          <div class="cf-processing-status">
            ${staleStatus}
          </div>
          <details class="cf-processing-details">
            <summary>show what you submitted</summary>
            ${submittedList}
          </details>
          <div style="margin-top:8px; display:flex; gap:6px;">
            <button class="cf-btn cf-btn-small" id="cf-dismiss-stale">dismiss</button>
            <button class="cf-btn cf-btn-small" id="cf-keep-waiting">keep waiting</button>
          </div>
        `;
      } else {
        const live = watcherAlive();
        banner.innerHTML = `
          <div class="cf-processing-row">
            <div class="${live ? "cf-pulse" : "cf-spinner"}" aria-hidden="true"></div>
            <div class="cf-processing-body">
              <strong>${live ? "Claude is on it ✨" : "Claude is processing…"}</strong>
              <span class="cf-processing-meta">${live ? "watching this doc · " : ""}${answeredMeta} · submitted ${submittedAgo}</span>
            </div>
          </div>
          <details class="cf-processing-details">
            <summary>show what you submitted</summary>
            ${submittedList}
          </details>
        `;
      }
      list.appendChild(banner);
      // Wire dismiss/keep-waiting after the banner is in the DOM
      if (S.isBatchStale) {
        const dis = document.getElementById("cf-dismiss-stale");
        const wait = document.getElementById("cf-keep-waiting");
        if (dis) dis.addEventListener("click", () => {
          // Drop the banner; the inbox entry remains for the agent to pick up later
          S.lastSubmittedBatch = null;
          S.isBatchStale = false;
          if (S.staleTimer) { clearTimeout(S.staleTimer); S.staleTimer = null; }
          saveLS();
          syncTitle();
          renderPending();
        });
        if (wait) wait.addEventListener("click", () => {
          // Reset the staleness flag; restart the timer
          S.isBatchStale = false;
          if (S.staleTimer) clearTimeout(S.staleTimer);
          S.staleTimer = setTimeout(() => {
            if (S.lastSubmittedBatch && !lastBatchProcessed() && !watcherAlive()) {
              S.isBatchStale = true;
              renderPending();
            }
          }, STALE_AFTER_MS);
          renderPending();
        });
      }
    }

    S.pending.forEach((c) => {
      const item = document.createElement("div");
      item.className = "cf-comment-item";
      const quote = document.createElement("div");
      quote.className = "cf-comment-quote";
      if (c.type === "general") {
        quote.classList.add("cf-comment-general");
        quote.textContent = "general question";
      } else if (c.type === "elements") {
        quote.innerHTML = c.elements.map(e =>
          `<div>${escapeHtml(e.tag)}${e.id ? "#" + escapeHtml(e.id) : ""} — <span style="opacity:0.7">${escapeHtml(e.text_snippet.slice(0, 60))}${e.text_snippet.length > 60 ? "…" : ""}</span></div>`
        ).join("");
      } else if (c.type === "control") {
        quote.classList.add("cf-comment-control");
        const picked = Array.isArray(c.label) ? c.label.join(", ") : c.label;
        quote.innerHTML =
          `<div style="opacity:0.7">${escapeHtml(c.prompt || c.field || "answer")}</div>` +
          `<div>▸ ${escapeHtml(picked || "(no selection)")}</div>`;
      } else {
        quote.textContent = '"' + (c.quote || "") + '"';
      }
      const body = document.createElement("div");
      body.className = "cf-comment-body";
      body.textContent = c.comment;
      const meta = document.createElement("div");
      meta.className = "cf-comment-meta";
      const ts = document.createElement("span");
      ts.textContent = relTime(c.created_at);
      const del = document.createElement("button");
      del.className = "cf-comment-delete";
      del.textContent = "remove";
      del.addEventListener("click", () => {
        S.pending = S.pending.filter((x) => x.id !== c.id);
        saveLS();
        renderPending();
      });
      meta.appendChild(ts);
      meta.appendChild(del);
      item.appendChild(quote);
      item.appendChild(body);
      item.appendChild(meta);
      list.appendChild(item);
    });
    $("cf-submit").disabled = S.pending.length === 0;
    updateBadge();
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function relTime(iso) {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    return d.toLocaleTimeString();
  }

  function updateBadge() {
    const badge = $("cf-badge");
    // Badge counts only pending comments. Once submitted, the processing
    // banner is the visible state — no need to also bump the badge.
    badge.textContent = S.pending.length > 0 ? String(S.pending.length) : "";
  }

  // ---------------- Submit batch ----------------
  // Arm the "nobody picked this up" warning. Restarted on every submit.
  function armStaleTimer() {
    if (S.staleTimer) clearTimeout(S.staleTimer);
    S.staleTimer = setTimeout(() => {
      if (S.lastSubmittedBatch && !lastBatchProcessed() && !watcherAlive()) {
        S.isBatchStale = true;
        renderPending();
      }
    }, STALE_AFTER_MS);
  }

  // The ONE network path to the inbox. Both the panel batch and the first-class
  // whisper widget POST through here → FEEDBACK_URL → feedback/inbox.jsonl.
  // There is deliberately no second inbox or parallel endpoint.
  async function sendComments(snapshot) {
    const commentIds = snapshot.map(c => c.id);
    const batch = {
      submitted_at: new Date().toISOString(),
      page_url: location.pathname,
      comments: snapshot,
    };
    const resp = await fetch(FEEDBACK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(batch),
    });
    if (!resp.ok) throw new Error("server returned " + resp.status);
    S.lastSubmittedBatch = {
      comment_ids: commentIds,
      submitted_at: batch.submitted_at,
      pending_snapshot: snapshot,
    };
    S.isBatchStale = false;
    armStaleTimer();
    return batch;
  }

  async function submitBatch() {
    if (!S.pending.length) return;
    const snapshot = S.pending.slice();
    try {
      await sendComments(snapshot);
      S.pending = [];
      saveLS();
      syncTitle();
      renderPending();
      showToast("batch sent — Claude is processing", 3500);
    } catch (e) {
      console.error(e);
      showToast("failed to send: " + e.message, 4500);
    }
  }

  // ---------------- First-class whisper widget ----------------
  async function sendWhisper() {
    const ta = $("cf-whisper-text");
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;
    const comment = {
      type: "general",
      comment: text,
      id: "c-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      created_at: new Date().toISOString(),
    };
    const btn = $("cf-whisper-send");
    if (btn) btn.disabled = true;
    // Queue onto the SAME pending→inbox path as selections and controls — one
    // submit-batch sends everything together. (A whisper used to POST instantly,
    // bypassing the batch; that surprised the reader and split the conversation.)
    S.pending.push(comment);
    ta.value = "";
    saveLS();
    renderPending();
    openPanel();
    setActiveTab("pending");
    showToast("queued — submit batch to send ✨", 2800);
    // Box is empty again — a held auto-reload can resume.
    scheduleAutoReload();
    // re-disable until the box has text again
    if (btn) btn.disabled = ta.value.trim().length === 0;
  }

  function syncWhisperSendState() {
    const ta = $("cf-whisper-text");
    const btn = $("cf-whisper-send");
    if (ta && btn) btn.disabled = ta.value.trim().length === 0;
  }

  // ---------------- Title sync ----------------
  // The tab title reflects what state the batch is in, so the user can tell
  // at a glance from another tab. Precedence (highest first):
  //   🔔  changes ready (pendingReload active)
  //   ⏳  agent is processing a submitted batch
  //   (no prefix) — idle
  function syncTitle() {
    if (!S.originalTitle) return;
    let prefix = "";
    if (S.pendingReload) prefix = "🔔 ";
    else if (S.lastSubmittedBatch) prefix = "⏳ ";
    document.title = prefix + S.originalTitle;
  }

  // ---------------- Pending-reload state ----------------
  function setPendingReload(addCount) {
    S.pendingReloadCount += addCount;
    const n = S.pendingReloadCount;
    const msg = `${n} change${n === 1 ? "" : "s"} ready, reload to see`;
    $("cf-reload-msg").textContent = msg;
    $("cf-reload-banner").classList.add("cf-visible");
    if (!S.pendingReload) {
      S.pendingReload = true;
      if (!S.originalTitle) S.originalTitle = document.title;
    }
    syncTitle();
    scheduleAutoReload();
  }

  // The doc AUTHOR regenerated the page (new index.html / source.json). That's
  // a different signal from a feedback change, so it doesn't inflate the
  // "N changes ready" count — but it feeds the SAME cancelable auto-reload path
  // (and honors the same pause / unsent-work guards via scheduleAutoReload).
  function triggerContentReload() {
    if (S.pendingReload) { scheduleAutoReload(); return; }
    S.pendingReload = true;
    if (!S.originalTitle) S.originalTitle = document.title;
    $("cf-reload-msg").textContent = "document updated, reloading…";
    $("cf-reload-banner").classList.add("cf-visible");
    syncTitle();
    scheduleAutoReload();
  }

  // Don't yank a reader who's mid-thought: an open editor or unsent whisper text
  // means we hold off the auto-reload (the banner + R still work). Pending
  // comments survive the reload via localStorage, so they don't block it.
  function hasUnsentWork() {
    const ed = $("cf-editor");
    if (ed && ed.classList.contains("cf-visible")) return true;
    const w = $("cf-whisper-text");
    if (w && w.value.trim()) return true;
    return false;
  }

  function scheduleAutoReload() {
    if (!S.pendingReload) return;
    if (S.autoReloadPaused) return;
    if (hasUnsentWork()) return;
    if (S.autoReloadTimer) return;   // already counting down
    showToast("updating…", AUTO_RELOAD_DELAY_MS + 600);
    S.autoReloadTimer = setTimeout(() => {
      S.autoReloadTimer = null;
      // Re-check at fire time — the reader may have started typing in the window.
      if (S.autoReloadPaused || hasUnsentWork()) return;
      doReload();
    }, AUTO_RELOAD_DELAY_MS);
  }

  function cancelAutoReload() {
    if (S.autoReloadTimer) { clearTimeout(S.autoReloadTimer); S.autoReloadTimer = null; }
  }

  function toggleAutoReloadPause() {
    S.autoReloadPaused = !S.autoReloadPaused;
    const btn = $("cf-reload-pause");
    if (btn) btn.textContent = S.autoReloadPaused ? "resume auto" : "pause auto";
    if (S.autoReloadPaused) {
      cancelAutoReload();
      showToast("auto-reload paused — press R when ready", 2500);
    } else {
      showToast("auto-reload on", 1500);
      scheduleAutoReload();
    }
  }

  function doReload() {
    if (!S.pendingReload) return;
    sessionStorage.setItem("cf-scroll-y", String(window.scrollY));
    sessionStorage.setItem("cf-auto-tour", "1");
    // Restore the title before unload so the OS tab-list briefly sees the
    // clean version (mostly cosmetic; the new page sets its own title anyway).
    if (S.originalTitle) document.title = S.originalTitle;
    location.reload();
  }

  function lastBatchProcessed() {
    if (!S.lastSubmittedBatch) return true;
    const answered = answeredIds();
    // Processed only when EVERY submitted comment has a response. A PARTIAL
    // reply (e.g. 3 of 7 answered) keeps the batch visible with per-comment
    // status, so the reader can see what's still owed instead of the banner
    // silently clearing as if everything were done.
    for (const id of S.lastSubmittedBatch.comment_ids) {
      if (!answered.has(id)) return false;
    }
    return true;
  }


  // ---------------- History / polling ----------------
  async function fetchHistory() {
    try {
      const resp = await fetch(HISTORY_URL + "?t=" + Date.now());
      if (!resp.ok) return;
      const text = await resp.text();
      if (text === S.lastHistoryString) return;
      S.lastHistoryString = text;
      // history.json changed → an agent is alive and writing. Push the stale
      // warning back so users don't see "no agent picked this up" while the
      // agent is actively working (just slower than the raw timeout).
      if (S.lastSubmittedBatch && !S.isBatchStale) {
        if (S.staleTimer) clearTimeout(S.staleTimer);
        S.staleTimer = setTimeout(() => {
          if (S.lastSubmittedBatch && !lastBatchProcessed() && !watcherAlive()) {
            S.isBatchStale = true;
            renderPending();
          }
        }, STALE_AFTER_MS);
      }
      const parsed = JSON.parse(text);
      S.history = Array.isArray(parsed) ? parsed : [];
      onHistoryUpdated();
    } catch (e) { /* network glitch */ }
  }

  async function fetchWatcher() {
    try {
      const resp = await fetch(WATCHER_URL + "?t=" + Date.now());
      if (!resp.ok) { S.watcherBeat = null; renderPresence(); return; }
      const b = await resp.json();
      S.watcherBeat = (b && typeof b.ts === "number") ? b : null;
    } catch (e) {
      S.watcherBeat = null;   // no file / not served → no presence claimed
    }
    renderPresence();
    // A live agent means the "nobody's watching" alarm should never fire.
    if (watcherAlive() && S.isBatchStale) {
      S.isBatchStale = false;
      renderPending();
    }
  }

  // Poll the page's own Last-Modified. A HEAD is cheap and the dev server
  // strips the "?t=" query before stat-ing the file, so the cache-buster is
  // safe. The first probe records the baseline; any later advance means the
  // board was regenerated → reuse the cancelable auto-reload path.
  async function fetchPageVersion() {
    try {
      const resp = await fetch(PAGE_VERSION_URL + "?t=" + Date.now(), { method: "HEAD" });
      if (!resp.ok) return;
      const lm = resp.headers.get("Last-Modified");
      if (!lm) return;   // server doesn't expose it → never fire (no false reloads)
      if (S.lastPageModified === null) { S.lastPageModified = lm; return; }
      if (lm !== S.lastPageModified) {
        S.lastPageModified = lm;
        triggerContentReload();
      }
    } catch (e) { /* network glitch */ }
  }

  // Paint the presence dot on the floating button + reflect it in any open panel.
  function renderPresence() {
    const fab = $("cf-toggle");
    if (fab) fab.classList.toggle("cf-present", watcherAlive());
    // If a batch is in flight, the processing banner's copy depends on presence.
    if (S.lastSubmittedBatch) renderPending();
  }

  function onHistoryUpdated() {
    renderHistory();
    updateBadge();
    // If we were waiting on a batch and history has now caught up, clear banner.
    // (The "Changes ready" UI takes over from the processing-banner; no toast.)
    if (S.lastSubmittedBatch && lastBatchProcessed()) {
      S.lastSubmittedBatch = null;
      S.isBatchStale = false;
      if (S.staleTimer) { clearTimeout(S.staleTimer); S.staleTimer = null; }
      saveLS();
      renderPending();
    } else if (S.lastSubmittedBatch) {
      // Partial reply — some of our comments are answered, some still awaiting.
      // Re-render so the per-comment ✓/⏳ chips and the "N of M answered" count
      // update live instead of the batch silently clearing.
      renderPending();
    }

    // Identify genuinely-new changes (arrived since the previous poll).
    const all = flattenChanges();
    const trulyNew = all.filter(ch => !S.knownChangeIds.has(ch.id));
    S.knownChangeIds = new Set(all.map(ch => ch.id));

    if (S.isFirstHistoryFetch) {
      // First fetch on page load — establish baseline silently. No toast,
      // no reload. Any changes already in history are already on the page.
      S.isFirstHistoryFetch = false;
      // If we just reloaded in response to a "Changes ready" banner, verify
      // the expected anchors actually materialized. Any still missing means
      // the agent's history.json doesn't match the HTML — surface that loudly
      // instead of letting the user trigger reload after reload.
      const expected = sessionStorage.getItem("cf-last-reload-anchors");
      if (expected) {
        sessionStorage.removeItem("cf-last-reload-anchors");
        const stillMissing = expected.split("|").filter(a => a && !findAnchorNode(a));
        if (stillMissing.length > 0) {
          console.error("[cf] anchor still missing after reload:", stillMissing);
          showToast(`⚠ anchor${stillMissing.length === 1 ? "" : "s"} not found: ${stillMissing.join(", ")}. Likely a typo in history.json or the HTML.`, 10000);
        }
      }
      return;
    }
    if (trulyNew.length === 0) {
      syncTitle();
      return;
    }
    // Only changes on THIS page warrant reloading THIS page. In a multi-page
    // (data-derived) doc, a new change on another node still appears in the
    // History thread — it just shouldn't nag this page to reload.
    const trulyNewHere = trulyNew.filter(changeIsHere);
    if (trulyNewHere.length === 0) {
      syncTitle();
      return;
    }

    // Live update — content arrived while the page was open. The user has
    // likely switched tabs, so surface a 🔔 + persistent banner instead of
    // hijacking the page with an auto-reload. Stash the expected anchors so
    // the post-reload first-fetch can detect a stale history.json.
    const missing = trulyNewHere.filter(ch => !findAnchorNode(ch.anchor || ch.id));
    if (missing.length > 0) {
      const missingIds = missing.map(ch => ch.anchor || ch.id).sort().join("|");
      sessionStorage.setItem("cf-last-reload-anchors", missingIds);
    } else {
      sessionStorage.removeItem("cf-last-reload-anchors");
    }
    setPendingReload(trulyNewHere.length);
  }

  function flattenChanges() {
    const out = [];
    for (const b of S.history) {
      for (const ch of (b.changes || [])) {
        out.push(Object.assign({ batch_id: b.batch_id, batch_ts: b.timestamp, comments: b.comments || [] }, ch));
      }
    }
    return out;
  }

  function findAnchorNode(anchor) {
    // Resolve a change anchor by, in order of preference:
    //   1. a responder-placed data-cf-change (may carry several, ~= word match);
    //   2. a renderer-stable data-cf-anchor (e.g. "n=the-binary§1") — these are
    //      content-addressed and regenerate identically on every re-bake, so a
    //      walkthrough survives `stddoc publish` re-running (PRD P0-1);
    //   3. a fragment-safe element id (e.g. "cf-the-binary-s1").
    const esc = CSS.escape(anchor);
    return (
      document.querySelector(`[data-cf-change~="${esc}"]`) ||
      document.querySelector(`[data-cf-anchor="${esc}"]`) ||
      (/^[A-Za-z][\w-]*$/.test(anchor) ? document.getElementById(anchor) : null)
    );
  }

  // ---- Multi-page awareness ----------------------------------------------
  // A data-derived (std-doc v2) doc is MANY pages sharing one feedback dir, so
  // a change's anchor may live on a different page than the one you're viewing.
  // The agent records an optional `page` on each change (the basename it edited,
  // from the comment's page_url). These helpers compare by basename so a leading
  // "/" or serving sub-path doesn't matter; pages are siblings in the dir.
  function pageBasename(p) {
    if (!p) return "";
    p = String(p).split("?")[0].split("#")[0];
    return (p.split("/").filter(Boolean).pop() || "index.html").toLowerCase();
  }
  function currentPage() { return pageBasename(location.pathname) || "index.html"; }
  function changePage(ch) { return ch && ch.page ? pageBasename(ch.page) : ""; }
  function changeIsHere(ch) {
    const cp = changePage(ch);
    return !cp || cp === currentPage();
  }

  function renderHistory() {
    const list = $("cf-history-list");
    list.innerHTML = "";
    const here = currentPage();
    let any = false;
    // Newest first — render each answered change as a conversation: the
    // reader's comment box ("you"), then the agent's reply box ("reply").
    for (let i = S.history.length - 1; i >= 0; i--) {
      const b = S.history[i];
      (b.changes || []).forEach((ch) => {
        any = true;
        const thread = document.createElement("div");
        thread.className = "cf-thread";

        // YOU — the comment(s) that prompted this change
        const asked = (ch.in_response_to || [])
          .map((cid) => (b.comments || []).find((c) => c.id === cid))
          .filter(Boolean);
        asked.forEach((c) => {
          const you = document.createElement("div");
          you.className = "cf-bubble cf-you";
          const who = document.createElement("div");
          who.className = "cf-bubble-who";
          who.textContent = "you";
          const txt = document.createElement("div");
          txt.className = "cf-bubble-text";
          if (c.type === "control") {
            const v = Array.isArray(c.label) ? c.label.join(", ") : c.label;
            txt.textContent = `${c.prompt || c.field || "answer"}: ${v}` + (c.comment ? ` — ${c.comment}` : "");
          } else {
            txt.textContent = c.comment || c.quote || "(comment)";
          }
          you.appendChild(who);
          you.appendChild(txt);
          thread.appendChild(you);
        });

        // REPLY — the agent's change
        const reply = document.createElement("div");
        reply.className = "cf-bubble cf-reply";
        reply.dataset.changeId = ch.id;
        const rwho = document.createElement("div");
        rwho.className = "cf-bubble-who";
        rwho.textContent = "reply" + (b.timestamp ? " · " + b.timestamp.replace("T", " ").replace("Z", "") : "");
        const rtitle = document.createElement("div");
        rtitle.className = "cf-bubble-text cf-reply-title";
        rtitle.textContent = ch.title || ch.id;
        reply.appendChild(rwho);
        reply.appendChild(rtitle);
        if (ch.description) {
          const d = document.createElement("div");
          d.className = "cf-bubble-desc";
          d.textContent = ch.description;
          reply.appendChild(d);
        }
        const cp = changePage(ch);
        if (cp && cp !== here) {
          const pg = document.createElement("div");
          pg.className = "cf-bubble-page";
          pg.textContent = "↗ on " + cp + " — click to open";
          reply.appendChild(pg);
        } else if (!findAnchorNode(ch.anchor || ch.id)) {
          // Here-page change whose anchored region no longer exists after a
          // board regen (element ids shift between bakes). Quiet, non-alarming
          // note — the reply itself is never lost; it lives right here.
          const moved = document.createElement("div");
          moved.className = "cf-bubble-page";
          moved.textContent = "↳ the section this refers to has since changed";
          reply.appendChild(moved);
        }
        reply.title = (cp && cp !== here) ? ("open " + cp + " and jump to this change") : "jump to this change";
        reply.addEventListener("click", () => focusChange(ch, reply));
        thread.appendChild(reply);
        list.appendChild(thread);
      });
    }
    if (!any) {
      const empty = document.createElement("div");
      empty.className = "cf-history-empty";
      empty.textContent = "No replies yet. Once a comment is answered, the conversation shows up here — your note, then the reply.";
      list.appendChild(empty);
    }
    $("cf-tour").disabled = flattenChanges().length === 0;
  }

  function focusChange(ch, replyEl) {
    const anchor = ch.anchor || ch.id;
    if (!changeIsHere(ch)) {
      // Lives on another page — navigate there and focus once it loads.
      sessionStorage.setItem("cf-focus-anchor", anchor);
      location.href = changePage(ch);
      return;
    }
    focusAnchor(anchor, replyEl);
  }

  // `fallbackEl`, when given, is the reply bubble in the conversation thread.
  // The thread is the single source of truth: every message renders there
  // regardless of whether its original anchored region still exists. So when
  // a board regen restructures the page and an anchor can no longer resolve,
  // we never show a scary "couldn't find region" error and we never lose the
  // message — we quietly fall back to the reply in the thread.
  function focusAnchor(anchor, fallbackEl) {
    const node = findAnchorNode(anchor);
    if (!node) {
      if (fallbackEl) {
        document.querySelectorAll(".cf-change-active").forEach((el) => el.classList.remove("cf-change-active"));
        fallbackEl.classList.add("cf-change-active");
        fallbackEl.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      showToast("That section of the document has since changed — the reply still lives here in the conversation.", 4000);
      return;
    }
    document.querySelectorAll(".cf-change-active").forEach((el) => el.classList.remove("cf-change-active"));
    node.classList.add("cf-change-active");
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ---------------- Tour ----------------
  // Tour walks the FULL change history (all batches). The label shows N/M
  // absolute position. Start position is always the FIRST change of the
  // LATEST batch — so after a fresh batch the tour drops you straight onto
  // the newest content (e.g. 4/4 if the last batch added a single change).
  function startTour() {
    const all = flattenChanges();
    if (!all.length) return;
    let startIdx = 0;
    if (S.history.length > 0) {
      // Find the last batch that actually has changes
      for (let i = S.history.length - 1; i >= 0; i--) {
        const b = S.history[i];
        if (b.changes && b.changes.length > 0) {
          const firstOfLast = b.changes[0];
          const idx = all.findIndex(c => c.id === firstOfLast.id);
          if (idx >= 0) startIdx = idx;
          break;
        }
      }
    }
    S.tourState = { changes: all, index: startIdx };
    $("cf-tour-bar").classList.add("cf-visible");
    closePanel();
    tourStep(0);
  }
  function tourStep(delta) {
    if (!S.tourState) return;
    S.tourState.index = Math.max(0, Math.min(S.tourState.changes.length - 1, S.tourState.index + delta));
    const ch = S.tourState.changes[S.tourState.index];
    focusChange(ch);
    $("cf-tour-label").textContent = `${tourState.index + 1} / ${tourState.changes.length}`;
    $("cf-tour-prev").disabled = S.tourState.index === 0;
    $("cf-tour-next").disabled = S.tourState.index === S.tourState.changes.length - 1;
  }
  function exitTour() {
    S.tourState = null;
    $("cf-tour-bar").classList.remove("cf-visible");
    document.querySelectorAll(".cf-change-active").forEach((el) => el.classList.remove("cf-change-active"));
  }

  // ---------------- Panel ----------------
  function openPanel() { $("cf-panel").classList.add("cf-open"); }
  function closePanel() { $("cf-panel").classList.remove("cf-open"); }
  function togglePanel() {
    const p = $("cf-panel");
    if (p.classList.contains("cf-open")) closePanel(); else openPanel();
  }
  function setActiveTab(name) {
    document.querySelectorAll(".cf-tab").forEach((t) => t.classList.toggle("cf-tab-active", t.dataset.tab === name));
    document.querySelectorAll(".cf-tab-pane").forEach((p) => p.classList.toggle("cf-tab-pane-active", p.id === "cf-tab-" + name));
  }

  // ---------------- Event wiring ----------------
  function bindEvents() {
    $("cf-toggle").addEventListener("click", togglePanel);
    $("cf-close").addEventListener("click", closePanel);
    $("cf-add-general").addEventListener("click", openGeneralEditor);
    $("cf-submit").addEventListener("click", submitBatch);
    $("cf-elem-toggle").addEventListener("click", toggleElementMode);

    // CRITICAL FIX: mousedown.preventDefault keeps the text selection alive
    // through the click. Without it, the browser clears the selection on
    // mousedown, which causes our saved range to look invalid.
    const popupBtn = $("cf-popup-comment");
    popupBtn.addEventListener("mousedown", (e) => e.preventDefault());
    popupBtn.addEventListener("click", openTextCommentEditor);

    $("cf-elem-popup-comment").addEventListener("click", openElementCommentEditor);
    $("cf-elem-popup-clear").addEventListener("click", () => {
      clearElementSelection();
      hideElemPopup();
    });

    $("cf-editor-cancel").addEventListener("click", closeEditor);
    $("cf-editor-save").addEventListener("click", saveEditorComment);
    $("cf-editor-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); saveEditorComment(); }
      if (e.key === "Escape") closeEditor();
    });

    document.querySelectorAll(".cf-tab").forEach((t) => t.addEventListener("click", () => setActiveTab(t.dataset.tab)));
    $("cf-tour").addEventListener("click", startTour);
    $("cf-tour-prev").addEventListener("click", () => tourStep(-1));
    $("cf-tour-next").addEventListener("click", () => tourStep(1));
    $("cf-tour-exit").addEventListener("click", exitTour);
    $("cf-reload-now").addEventListener("click", doReload);
    $("cf-reload-pause").addEventListener("click", toggleAutoReloadPause);

    // First-class whisper widget
    $("cf-whisper-send").addEventListener("click", sendWhisper);
    $("cf-whisper-text").addEventListener("input", () => {
      syncWhisperSendState();
      // The reader is typing — don't reload out from under them.
      if (S.autoReloadTimer) cancelAutoReload();
    });
    $("cf-whisper-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); sendWhisper(); }
    });

    // If the page is reloaded any other way (browser refresh, Cmd-R), still
    // carry the auto-tour flag forward so the user's mental model holds:
    // "changes ready" → reload → tour opens.
    window.addEventListener("beforeunload", () => {
      if (S.pendingReload) {
        sessionStorage.setItem("cf-auto-tour", "1");
        sessionStorage.setItem("cf-scroll-y", String(window.scrollY));
      }
    });

    document.addEventListener("selectionchange", debounce(onSelectionChange, 120));

    // Element-mode interactions
    document.addEventListener("mouseover", onElemMouseOver);
    document.addEventListener("mouseout", onElemMouseOut);
    document.addEventListener("click", onElemClick, true);  // capture phase

    document.addEventListener("keydown", (e) => {
      // Esc is always-on (works inside text inputs too)
      if (e.key === "Escape") {
        if ($("cf-editor").classList.contains("cf-visible")) closeEditor();
        else if (S.elementMode) toggleElementMode();
        else if (S.tourState) exitTour();
        else closePanel();
        return;
      }
      // Cmd/Ctrl+Enter submits the pending batch — only when the panel is open
      // and you're NOT mid-comment in the editor (the editor textarea has its own
      // Cmd+Enter to save the single comment first). Restored from 18f4325 — it
      // was dropped in the c33e933 queue-merge.
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        if (!$("cf-editor").classList.contains("cf-visible") &&
            $("cf-panel").classList.contains("cf-open") &&
            !$("cf-submit").disabled) {
          e.preventDefault(); submitBatch();
        }
        return;
      }
      // Tour arrows: only while tour is active
      if (S.tourState && !isTypingTarget(e.target) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === "ArrowLeft")  { e.preventDefault(); tourStep(-1); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); tourStep(1);  return; }
      }
      // Single-letter shortcuts only when not typing and no modifiers held
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case "c": case "C":
          // Comment on the current text selection without reaching for the
          // floating 💬 — keyboard path to the same composer the popup opens.
          // Restored from 18f4325 (dropped in the c33e933 queue-merge).
          if (S.savedTextSelection && $("cf-selection-popup").classList.contains("cf-visible")) {
            e.preventDefault(); openTextCommentEditor();
          }
          break;
        case "f": case "F":
          e.preventDefault(); togglePanel(); break;
        case "p": case "P":
          e.preventDefault(); openPanel(); setActiveTab("pending"); break;
        case "h": case "H":
          e.preventDefault(); openPanel(); setActiveTab("history"); break;
        case "t": case "T":
          e.preventDefault();
          if (!$("cf-tour").disabled) startTour();
          break;
        case "r": case "R":
          if (S.pendingReload) { e.preventDefault(); doReload(); }
          break;
        case "?":
          e.preventDefault();
          showToast("C: comment on selection · F: feedback · P: pending · H: history · T: tour · R: reload when changes ready · ⌘/Ctrl+Enter: submit batch · ←/→: tour nav · Esc: close", 6500);
          break;
      }
    });
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || el.isContentEditable;
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  // ---------------- Structured controls (radio / checkbox / select) ----------------
  // A doc author marks a question block with data-cf-control. The reader answers
  // with a real 1980s control; "submit answer" pushes a STRUCTURED `control`-type
  // comment onto the same pending→inbox pipeline as text comments — so the agent
  // reads the choice directly (no prose to parse). Crash-safe via saveLS like any
  // other pending comment.
  function scanControls() {
    let auto = 0;
    document.querySelectorAll("[data-cf-control]").forEach((block) => {
      if (block._cfWired || insideOurUI(block)) return;
      const kind = (block.getAttribute("data-cf-control") || "").toLowerCase();
      if (!["radio", "checkbox", "select", "text"].includes(kind)) return;
      block._cfWired = true;
      const field = block.getAttribute("data-cf-id") || ("q-" + (++auto));
      block.dataset.cfId = field;
      // radios/checkboxes in one block share a name so the browser groups them
      if (kind === "radio" || kind === "checkbox") {
        block.querySelectorAll('input[type="' + kind + '"]').forEach((inp) => {
          if (!inp.name) inp.name = "cf-q-" + field;
        });
      }
      // inline footer: optional note + "submit answer" button
      const footer = document.createElement("div");
      footer.className = "cf-q-actions";
      const note = document.createElement("input");
      note.type = "text";
      note.className = "cf-q-note";
      note.placeholder = "add a note (optional)";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cf-q-submit";
      btn.textContent = "submit answer";
      btn.addEventListener("click", () => addControlAnswer(block, kind, field, note));
      footer.appendChild(note);
      footer.appendChild(btn);
      block.appendChild(footer);
    });
  }

  function controlChoices(block, kind) {
    if (kind === "text") return [];   // free-form: the textarea is the answer
    if (kind === "select") {
      const sel = block.querySelector("select");
      return sel ? Array.from(sel.options)
        .filter(o => o.value !== "")
        .map(o => ({ value: o.value, label: (o.textContent || "").trim() })) : [];
    }
    return Array.from(block.querySelectorAll('input[type="' + kind + '"]')).map((inp) => {
      const lab = inp.closest("label");
      return { value: inp.value, label: lab ? lab.textContent.trim() : inp.value, checked: inp.checked };
    });
  }

  function addControlAnswer(block, kind, field, noteEl) {
    const prompt = block.getAttribute("data-cf-prompt") || "";
    const choices = controlChoices(block, kind);
    let value, label;
    if (kind === "select") {
      const sel = block.querySelector("select");
      if (!sel || sel.value === "") { showToast("pick an option first"); return; }
      value = sel.value;
      label = (sel.options[sel.selectedIndex].textContent || "").trim();
    } else if (kind === "checkbox") {
      const on = choices.filter(c => c.checked);
      if (!on.length) { showToast("check at least one box"); return; }
      value = on.map(c => c.value);
      label = on.map(c => c.label);
    } else if (kind === "text") {
      const ta = block.querySelector("textarea.cf-q-text");
      const v = ta ? ta.value.trim() : "";
      if (!v) { showToast("type an answer first"); return; }
      value = v;
      label = v;
    } else { // radio
      const on = choices.find(c => c.checked);
      if (!on) { showToast("pick an option first"); return; }
      value = on.value;
      label = on.label;
    }
    const note = noteEl ? noteEl.value.trim() : "";
    S.pending.push({
      id: "c-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      type: "control",
      control: kind,
      field: field,
      prompt: prompt,
      value: value,
      label: label,
      choices: choices.map(c => ({ value: c.value, label: c.label })),
      comment: note,
      anchor: { cf_id: field },
      created_at: new Date().toISOString(),
    });
    if (noteEl) noteEl.value = "";
    saveLS();
    renderPending();
    openPanel();
    setActiveTab("pending");
    showToast("answer added");
  }

  // ---------------- Bootstrap ----------------
  function init() {
    S.originalTitle = document.title;
    assignAnchors();
    buildUI();
    bindEvents();
    scanControls();
    const ls = loadLS();
    S.pending = ls.pending || [];
    S.lastSubmittedBatch = ls.lastSubmittedBatch || null;
    syncTitle();
    renderPending();
    const shouldAutoTour = sessionStorage.getItem("cf-auto-tour") === "1";
    if (shouldAutoTour) sessionStorage.removeItem("cf-auto-tour");
    fetchHistory().then(() => {
      if (shouldAutoTour && flattenChanges().length > 0) {
        setTimeout(startTour, 250);
      }
      // Cross-page focus: a click on an off-page change navigated here with the
      // anchor stashed; now that the page (and its history) is loaded, focus it.
      const want = sessionStorage.getItem("cf-focus-anchor");
      if (want) {
        sessionStorage.removeItem("cf-focus-anchor");
        setTimeout(() => focusAnchor(want), 300);
      }
    });
    S.pollTimer = setInterval(fetchHistory, POLL_INTERVAL_MS);
    // Presence: poll the heartbeat too (drives the watching/on-it indicator).
    fetchWatcher();
    setInterval(fetchWatcher, POLL_INTERVAL_MS);
    // Content-change: record the page's baseline Last-Modified, then poll for
    // regenerations (board rewrites that don't touch history.json).
    fetchPageVersion();
    setInterval(fetchPageVersion, POLL_INTERVAL_MS);
    // Restore scroll position after a reload triggered by the "changes ready" flow
    const sy = sessionStorage.getItem("cf-scroll-y");
    if (sy) {
      sessionStorage.removeItem("cf-scroll-y");
      setTimeout(() => window.scrollTo(0, parseInt(sy, 10)), 0);
    }
  }

  // Exposed so an external reload timer (e.g. the board's "next tick" countdown)
  // can honor the SAME guards before forcing a reload: never yank a reader
  // mid-thought (open editor / unsent whisper text) and respect the pause
  // toggle. Returns true when a reload must be held off.
  window.__cfReloadBlocked = function () {
    return S.autoReloadPaused || hasUnsentWork();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
