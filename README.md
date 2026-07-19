# Janitor Greeting Recovery Toolkit

## 1. Install the userscript
- Install Tampermonkey (browser extension) if you don't have it.
- Tampermonkey dashboard → Create a new script → delete the placeholder → paste in `janitor-greeting-scraper.user.js` → Save.
- It only activates on `janitorai.com/characters/*` pages.

## 2. Run it
1. Open any character page on Janitor (logged in as usual — the script rides your existing session).
2. A small panel appears bottom-right: "Janitor Greeting Scraper".
3. Paste your collected list JSON (the `[{id, name, url, chats}, ...]` array from the earlier list-collector script) into the textarea → **Load Queue**.
4. Click **Start**. It will:
   - expand "Initial Messages" on the current page if needed
   - extract every greeting
   - navigate to the next un-processed character automatically
   - repeat until the queue is done (progress shown in the panel; refresh doesn't lose progress, it's saved via Tampermonkey storage)
5. When status says "All done!", click **Export JSON** → downloads `janitor_greetings_combined.json`.

Notes:
- **Stop** pauses; you can navigate away and resume later with **Start** again (it remembers where it left off).
- **Reset** wipes the queue/results if you want to start over.
- Characters with only 1 greeting are recorded with an empty greetings list (nothing to add) — the merge script handles that fine.
- If it seems stuck on one character, check the browser console for errors — Janitor's DOM structure can differ per-version; the extraction logic may need selector tweaks.

## 3. Merge into your local cards
Once you have `janitor_greetings_combined.json`:

```bash
python merge_greetings.py janitor_greetings_combined.json /path/to/SillyTavern/characters
```

- Matches each scraped character to a local PNG by name (normalized: strips emoji/punctuation, ignores anything after "|", case-insensitive).
- Writes the scraped greetings into `alternate_greetings` in both the V2 (`chara`) and V3 (`ccv3`) embedded chunks.
- Skips any greeting that's an exact duplicate of the existing `first_mes`.
- **Backs up every PNG it touches** into `characters/_pre_greeting_merge_backup/` before writing.
- Prints a report at the end: what got updated, what matched but had nothing new, and — importantly — anything that **couldn't be matched**, so you can fix those by hand (rename mismatch, etc.) instead of them silently vanishing.

Tested against two real exported cards (Captain Julian Blackwood, Weston) with a full write → re-read round trip to confirm the PNGs stay valid and ST-readable after the edit.
