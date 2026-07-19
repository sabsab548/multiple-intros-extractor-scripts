// ==UserScript==
// @name         Janitor Greeting Scraper
// @namespace    sabrina.local
// @version      1.0
// @description  Walk a list of JanitorAI character URLs, extract all "Initial Messages" per character, accumulate into storage, export as one JSON.
// @match        https://janitorai.com/characters/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const QUEUE_KEY = 'jgs_queue';       // array of {id, name, url, chats}
  const RESULTS_KEY = 'jgs_results';   // object keyed by id -> {name, url, greetings: []}
  const CURSOR_KEY = 'jgs_cursor';     // index into queue
  const RUNNING_KEY = 'jgs_running';   // bool

  const getQueue = () => GM_getValue(QUEUE_KEY, []);
  const getResults = () => GM_getValue(RESULTS_KEY, {});
  const getCursor = () => GM_getValue(CURSOR_KEY, 0);
  const isRunning = () => GM_getValue(RUNNING_KEY, false);

  // ---------- UI ----------
  const panel = document.createElement('div');
  panel.style.cssText = `
    position: fixed; bottom: 16px; right: 16px; z-index: 999999;
    background: #1e1e1e; color: #eee; font: 12px monospace;
    border: 1px solid #444; border-radius: 8px; padding: 10px;
    width: 300px; box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  `;
  panel.innerHTML = `
    <div style="font-weight:bold; margin-bottom:6px;">Janitor Greeting Scraper</div>
    <div id="jgs-status" style="margin-bottom:6px; white-space:pre-wrap;">idle</div>
    <textarea id="jgs-input" placeholder="Paste queue JSON here (from list collector)" style="width:100%; height:60px; background:#111; color:#eee; border:1px solid #333; margin-bottom:6px;"></textarea>
    <div style="display:flex; gap:4px; flex-wrap:wrap;">
      <button id="jgs-load">Load Queue</button>
      <button id="jgs-start">Start</button>
      <button id="jgs-stop">Stop</button>
      <button id="jgs-export">Export JSON</button>
      <button id="jgs-reset">Reset</button>
    </div>
  `;
  document.body.appendChild(panel);

  const statusEl = panel.querySelector('#jgs-status');
  const setStatus = (text) => { statusEl.textContent = text; };

  const refreshStatus = () => {
    const queue = getQueue();
    const results = getResults();
    const cursor = getCursor();
    setStatus(`queue: ${queue.length}\ndone: ${Object.keys(results).length}\ncursor: ${cursor}\nrunning: ${isRunning()}`);
  };

  panel.querySelector('#jgs-load').addEventListener('click', () => {
    const raw = panel.querySelector('#jgs-input').value.trim();
    if (!raw) { alert('Paste the queue JSON first.'); return; }
    try {
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) throw new Error('not an array');
      GM_setValue(QUEUE_KEY, data);
      GM_setValue(CURSOR_KEY, 0);
      refreshStatus();
      alert(`Loaded ${data.length} characters into the queue.`);
    } catch (e) {
      alert('Could not parse that JSON: ' + e.message);
    }
  });

  panel.querySelector('#jgs-start').addEventListener('click', () => {
    GM_setValue(RUNNING_KEY, true);
    refreshStatus();
    runStep();
  });

  panel.querySelector('#jgs-stop').addEventListener('click', () => {
    GM_setValue(RUNNING_KEY, false);
    refreshStatus();
  });

  panel.querySelector('#jgs-export').addEventListener('click', () => {
    const results = getResults();
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'janitor_greetings_combined.json';
    a.click();
  });

  panel.querySelector('#jgs-reset').addEventListener('click', () => {
    if (!confirm('Clear queue, results, and cursor?')) return;
    GM_deleteValue(QUEUE_KEY);
    GM_deleteValue(RESULTS_KEY);
    GM_deleteValue(CURSOR_KEY);
    GM_setValue(RUNNING_KEY, false);
    refreshStatus();
  });

  refreshStatus();

  // ---------- Extraction (same logic that worked in console) ----------
  const expandInitialMessages = async () => {
    const buttons = Array.from(document.querySelectorAll('[class*="AccordionButton"], button'));
    const btn = buttons.find(b => /initial messages/i.test(b.textContent || ''));
    if (!btn) return false;
    const expanded = btn.getAttribute('aria-expanded');
    if (expanded === 'false') {
      btn.click();
      await wait(500);
    }
    return true;
  };

  const getPanel = () => {
    const counter = document.querySelector('[class*="messageCounter"]');
    if (!counter) return null;
    return counter.closest('[id^="panel-info"]') || counter.closest('[class*="AccordionPanel"]');
  };

  const extractAllGreetings = async () => {
    const found = await expandInitialMessages();
    if (!found) return []; // no Initial Messages section at all

    // give the panel a moment to render after expansion
    await wait(400);
    const panelEl = getPanel();
    if (!panelEl) return []; // only one greeting, no swiper UI, nothing extra to grab

    const getContent = () => {
      const el = panelEl.querySelector('[class*="characterInfoMarkdownContainer"]');
      if (!el) return '';
      return Array.from(el.querySelectorAll('p, hr'))
        .map(node => node.tagName === 'HR' ? '---' : node.innerText)
        .join('\n\n')
        .trim();
    };
    const getPos = () => {
      const el = panelEl.querySelector('[class*="messageCounter"]');
      if (!el) return { cur: 1, total: 1 };
      const [cur, total] = el.textContent.split('/').map(s => parseInt(s.trim(), 10));
      return { cur, total };
    };
    const nextBtn = () => panelEl.querySelector('button[aria-label="Next message"]');
    const prevBtn = () => panelEl.querySelector('button[aria-label="Previous message"]');

    const waitForChange = async (prevText, timeoutMs = 3000) => {
      const start = Date.now();
      let text = getContent();
      while (text === prevText && Date.now() - start < timeoutMs) {
        await wait(100);
        text = getContent();
      }
      return text;
    };

    let { cur, total } = getPos();
    if (total <= 1) return [getContent()];

    let guard = 0;
    while (cur > 1 && guard < 20) {
      const before = getContent();
      prevBtn().click();
      await waitForChange(before);
      cur = getPos().cur;
      guard++;
    }

    const messages = [getContent()];
    for (let i = 1; i < total; i++) {
      const before = getContent();
      nextBtn().click();
      messages.push(await waitForChange(before));
    }
    return messages;
  };

  // ---------- Queue runner ----------
  const findCurrentQueueItem = () => {
    const queue = getQueue();
    const here = location.href.split('?')[0].replace(/\/$/, '');
    return queue.find(item => here === item.url.split('?')[0].replace(/\/$/, ''));
  };

  const runStep = async () => {
    if (!isRunning()) return;
    const queue = getQueue();
    if (queue.length === 0) { setStatus('queue is empty — paste and load one first.'); return; }

    const item = findCurrentQueueItem();
    const results = getResults();

    if (item && !results[item.id]) {
      setStatus(`extracting: ${item.name}`);
      await wait(800); // let the page settle
      const greetings = await extractAllGreetings();
      results[item.id] = { name: item.name, url: item.url, greetings };
      GM_setValue(RESULTS_KEY, results);
      refreshStatus();
    }

    // find next un-processed item in the queue
    const nextItem = queue.find(q => !getResults()[q.id]);
    if (!nextItem) {
      setStatus('All done! Click "Export JSON".');
      GM_setValue(RUNNING_KEY, false);
      return;
    }
    if (!isRunning()) return;
    setStatus(`navigating to: ${nextItem.name}`);
    await wait(400);
    location.href = nextItem.url;
  };

  // auto-continue on page load if we were mid-run
  if (isRunning()) {
    window.addEventListener('load', () => setTimeout(runStep, 600));
  }
})();
