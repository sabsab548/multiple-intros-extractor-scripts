(async function () {
  const wait = (ms) => new Promise(r => setTimeout(r, ms));

  const ITEM_SELECTOR = '[class*="_accordionItem_"]';
  const collected = new Map();

  const collectVisible = () => {
    document.querySelectorAll(ITEM_SELECTOR).forEach(item => {
      if (collected.has(item.id)) return;
      const nameEl = item.querySelector('[class*="_characterName_"]');
      const linkEl = item.querySelector('a[class*="_actionButton_"]');
      const chatEl = item.querySelector('[class*="_chatCount_"]');
      if (!linkEl) return; // not fully rendered yet
      collected.set(item.id, {
        id: item.id,
        name: nameEl ? nameEl.textContent.trim() : null,
        url: new URL(linkEl.getAttribute('href'), location.origin).href,
        chats: chatEl ? parseInt(chatEl.textContent.trim(), 10) : null
      });
    });
  };

  const firstItem = document.querySelector(ITEM_SELECTOR);
  if (!firstItem) { alert('No character list items found — scroll the list into view first.'); return; }

  // find the actual scrolling container (not necessarily the window)
  const findScrollParent = (el) => {
    let node = el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
        return node;
      }
      node = node.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  };
  const scrollParent = findScrollParent(firstItem);

  // detect row height from two consecutive translateY values, fallback to 120
  const getTranslateY = (el) => {
    const m = el.style.transform && el.style.transform.match(/translateY\(([\d.]+)px\)/);
    return m ? parseFloat(m[1]) : null;
  };
  const rows = Array.from(document.querySelectorAll('[data-index]'))
    .sort((a, b) => parseInt(a.dataset.index) - parseInt(b.dataset.index));
  let itemHeight = 120;
  if (rows.length >= 2) {
    const y0 = getTranslateY(rows[0]);
    const y1 = getTranslateY(rows[1]);
    if (y0 !== null && y1 !== null && y1 > y0) itemHeight = y1 - y0;
  }

  collectVisible();
  let lastSize = -1, stableCount = 0, guard = 0;

  while (stableCount < 4 && guard < 1000) {
    const isWindow = scrollParent === document.scrollingElement || scrollParent === document.documentElement;
    if (isWindow) window.scrollBy(0, itemHeight * 2);
    else scrollParent.scrollTop += itemHeight * 2;

    await wait(350);
    collectVisible();

    if (collected.size === lastSize) stableCount++;
    else { stableCount = 0; lastSize = collected.size; }
    guard++;
  }

  const results = Array.from(collected.values());
  console.log(`Collected ${results.length} characters. Stopped after ${guard} scroll steps.`);
  console.table(results.map(r => ({ name: r.name, chats: r.chats })));

  const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'janitor_character_list.json';
  a.click();
})();