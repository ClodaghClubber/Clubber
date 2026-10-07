# GAA Fixtures Dashboard — Project Context

## What this project is
A GAA fixtures dashboard hosted on GitHub Pages, backed by a Cloudflare Worker and KV storage.
- **Live URL:** https://clodaghclubber.github.io/Clubber/
- **Repo:** https://github.com/ClodaghClubber/Clubber (branch: `main`)
- **Local path:** `C:\Users\cloda\Desktop\my-fixtures-dashboard\`

## Deployment
- GitHub Actions deploys automatically on push to `main` via `.github/workflows/deploy.yml`
- **Always `git push` after committing** — GitHub Pages only updates on push
- If a deployment gets stuck in queue, check for a zombie queued run (run ID `37333005826` has blocked the queue multiple times) and cancel it with `gh run cancel <id>`

## Infrastructure
- **Cloudflare Worker:** `gaa-fixtures-proxy-v2`
- **KV namespace ID:** `978753aac88b476bbe43afd5b69cdb45` (binding: `FIXTURE_STATUS`)
- **KV keys in use:**
  - `cache_A` through `cache_E` — fixture data by county group
  - `statusHistory` — per-fixture status change history + Clubber Pick audit log
  - `fixtureOverrides` — field-level overrides synced from the dashboard

## Security constraint
**Never handle API keys, passwords, or secrets directly.** Use `wrangler secret put` interactive prompt only — never pass secrets as arguments or write them to files.

## Key files
- `index.html` — entire frontend (single-file app)
- `worker/worker.js` — Cloudflare Worker source
- `Clubber/teamMappings.json` — club name → UUID mappings, county-keyed
- `.github/workflows/deploy.yml` — GitHub Actions Pages deployment

## teamMappings.json conventions
- Plain UUID string value: club name already exists in the Worker's live lookup
- Object `{id, name}` value: newly added club not yet in live lookup, or name variant that needs remapping
- The `name` field in object entries is the canonical display name to use
- Always add aliases for Irish-language name variants (fada characters etc.) pointing to the same ID
- After editing, commit and push — no separate deploy step needed

## Frontend architecture (index.html)
- All state in memory; persisted to `localStorage` (`gaaFixtureOverrides`, `gaaFixtureChangelog`, etc.)
- `fixtureOverrides` — field overrides keyed by `keyOf(f)` (`county|teamA|teamB|date`)
- `fixtureChangelog` — per-fixture history keyed by `stableKeyOf(f)` (`county|teamA|teamB|competition`)
- `currentUser` — logged-in user name, used for audit attribution
- `syncOverrides()` — sends field changes to the worker with user + device
- `getFiltered()` — returns fixtures matching all active filter controls; used for render, select-all, and export
- `selected` — Set of fixture IDs currently checked; persists across filter changes
- `normClubName()` — normalises club names for fuzzy matching; strips diacritics via NFD before removing non-ASCII
- `stripDiacritics()` — NFD decomposition helper used in name normalisation and teamMappings lookup
- `lookupTeam()` — resolves a club name to an ID, tries exact key then diacritic-stripped key in teamMappings, then fuzzy match

## Worker architecture (worker.js)
- Serves fixture data from KV cache groups
- `setOverrides` endpoint — receives field overrides from dashboard, writes to KV
- `statusHistory` KV key — stores status changes and Clubber Pick toggles with timestamp, user, device
- Pick toggles stored as `{status: 'Pick: Yes'/'Pick: No', ...}` entries in statusHistory

## Known gotchas
- **Nested backticks in template literals** will cause a silent syntax error that breaks the entire app — use string concatenation (`'...' + var + '...'`) inside `tr.innerHTML` template literals
- **Smart/curly quotes** (`'` `'`) in JS source cause syntax errors — always use plain ASCII apostrophes. Run `python -c "content=open('index.html','rb').read(); content=content.replace(b'\xe2\x80\x98',b\"'\").replace(b'\xe2\x80\x99',b\"'\"); open('index.html','wb').write(content)"` to clean them if they appear
- **CSV file encoding** — all `FileReader.readAsText()` calls must pass `'UTF-8'` explicitly, otherwise Windows may use windows-1252 and corrupt fada characters
- **Non-breaking spaces** (`\xc2\xa0`) can appear in club names copy-pasted from external sources — strip them when adding teamMappings entries
- **Excel export** defaults to Approved-only when no status filter is active, to prevent Proposed fixtures leaking into exports

## Workflow for adding a new club to teamMappings.json
1. Get the club's UUID from the Clubber site or API
2. Add an entry under the correct county:
   - If the club is new (not in Worker's live lookup): `"Club Name": {"id": "uuid", "name": "Canonical Name"}`
   - If it already exists in the live lookup: `"Club Name": "uuid"`
3. Add aliases for any name variants the dashboard might receive (Irish name, abbreviations, punctuation variants)
4. Commit and push

## User preferences
- Link files in responses rather than dumping full content
- Always push to GitHub after committing
- Concise responses
