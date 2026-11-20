// Clubber API - the Fixtures Dashboard's data and actions for Clubber to
// integrate (see docs/clubber-api.md and docs/clubber-api.openapi.yaml).
//
// Everything here is additive: it reads and writes the same KV data as the
// dashboard (statuses, overrides, manualFixtures, statusHistory, editHistory),
// in the same formats, so the dashboard and Clubber can run side by side.
// The Clubber fields come from the dashboard's own rules (clubber-rules.js,
// generated from index.html), so the API and the export dialog always agree.
import { createClubberRules } from './clubber-rules.js';

const API_PREFIX = '/api/v1';
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 366;
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;
const VERSIONS_KEY = 'apiFixtureVersions';     // id -> {h: hash, at: ISO, gone?: true}
const WEBHOOK_STATE_KEY = 'apiWebhookState';   // {lastSentAt}
const TOMBSTONE_DAYS = 30;
const PAGES_BASE = 'https://clodaghclubber.github.io/Clubber/Clubber/';
const LOOKUP_URL = 'https://prodclubbertvstorageacc.blob.core.windows.net/lookups/sportsCountiesLookup.json';
const API_DEVICE = 'Clubber API';

const STATUSES = ['Proposed', 'Approved', 'Rejected'];
const EDIT_FIELDS = ['date', 'time', 'venue', 'round', 'competition', 'code', 'county', 'teamA', 'teamB', 'teamACounty', 'teamBCounty'];
const FIELD_LABEL = { date: 'Date', time: 'Time', venue: 'Venue', round: 'Round', county: 'County', teamA: 'Team A', teamB: 'Team B',
  competition: 'Competition', code: 'Code', teamACounty: 'Team A county', teamBCounty: 'Team B county' };
const CLUBBER_FIELDS = ['clubberGameId', 'clubberCreated', 'clubberPick', 'hero'];
const CREW_FIELDS = ['socials', 'socialsEmail', 'support2', 'support2Email', 'videographer', 'videographerEmail',
  'replay', 'cameras', 'unit', 'unitSystem'];

// ---------------------------------------------------------------- helpers
const API_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-User-Name',
  'Access-Control-Max-Age': '86400',
};
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...API_CORS, ...extra },
  });
}
function apiError(status, code, message, details) {
  return json({ ok: false, error: { code, message, ...(details ? { details } : {}) } }, status);
}
class ApiError extends Error {
  constructor(status, code, message, details) { super(message); this.status = status; this.code = code; this.details = details; }
}
const b64url = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
const isIsoDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const dublinToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function safeEqual(a, b) {
  // Compare digests so the check takes the same time whatever the input
  const [x, y] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function readJsonKV(kv, key, fallback) {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try { const v = JSON.parse(raw); return v == null ? fallback : v; } catch { return fallback; }
}

// ------------------------------------------------------- rules + their data
// The data the dashboard loads before it can build Clubber payloads: the
// teamMappings / competitionLookup files (same GitHub Pages copies the
// dashboard reads), club mappings and venue choices made in the dashboard
// (KV), and Clubber's club / school / university / venue lists.
let _rulesMemo = null; // { at, rules }
const RULES_TTL_MS = 2 * 60 * 1000;

async function getClubberLookup(kv) {
  const raw = await kv.get('clubberLookup');
  if (raw) {
    try {
      const { data, cachedAt } = JSON.parse(raw);
      if (data && Date.now() - new Date(cachedAt).getTime() < 24 * 60 * 60 * 1000) return data;
    } catch { /* refetch */ }
  }
  const resp = await fetch(LOOKUP_URL);
  if (!resp.ok) throw new Error('Clubber club list unavailable (HTTP ' + resp.status + ')');
  const data = await resp.json();
  await kv.put('clubberLookup', JSON.stringify({ data, cachedAt: new Date().toISOString() }), { expirationTtl: 60 * 60 * 48 });
  return data;
}

// Same as the dashboard's index building (index.html, "Build flat
// county->clubs index from sportsCountiesLookup")
function buildLookupIndexes(sc, normClubName) {
  const sportsCountiesIndex = {}, sportsUniversitiesIndex = {}, clubberVenuesIndex = {}, sportsSchoolsIndex = {};
  for (const sport of (sc.sportList || [])) {
    if (sport.sportType !== 'GAA') continue;
    for (const county of (sport.countyList || [])) {
      const key = county.name.toLowerCase();
      if (!sportsCountiesIndex[key]) sportsCountiesIndex[key] = [];
      for (const club of (county.clubsList || [])) {
        sportsCountiesIndex[key].push({ id: club.id, county: county.name, name: club.name, normName: normClubName(club.name) });
      }
      if (!sportsUniversitiesIndex[key]) sportsUniversitiesIndex[key] = [];
      for (const uni of (county.universityList || [])) {
        sportsUniversitiesIndex[key].push({ id: uni.id, county: county.name, name: uni.name, normName: normClubName(uni.name) });
      }
      if (!clubberVenuesIndex[key]) clubberVenuesIndex[key] = [];
      for (const v of (county.venuesList || [])) {
        if (v && v.name) clubberVenuesIndex[key].push({ county: county.name, name: v.name });
      }
      if (!sportsSchoolsIndex[key]) sportsSchoolsIndex[key] = [];
      for (const school of (county.schoolsList || [])) {
        sportsSchoolsIndex[key].push({ id: school.id, county: county.name, name: school.name, normName: normClubName(school.name) });
      }
    }
  }
  return { sportsCountiesIndex, sportsUniversitiesIndex, clubberVenuesIndex, sportsSchoolsIndex };
}

export async function loadRulesData(kv, deps, fetchFile) {
  const getFile = fetchFile || (async name => {
    const r = await fetch(PAGES_BASE + name + '?v=' + Math.floor(Date.now() / RULES_TTL_MS));
    if (!r.ok) throw new Error(name + ' unavailable (HTTP ' + r.status + ')');
    return r.json();
  });
  const [teamMappings, competitionLookup, lookup, extra, venueMappings] = await Promise.all([
    getFile('teamMappings.json'), getFile('competitionLookup.json'), getClubberLookup(kv),
    readJsonKV(kv, deps.TEAM_MAPPINGS_EXTRA_KEY, {}), readJsonKV(kv, deps.VENUE_MAPPINGS_KEY, {}),
  ]);
  // applyTeamMappingsExtra: dashboard mappings win over the file
  for (const [county, teams] of Object.entries(extra || {})) teamMappings[county] = Object.assign(teamMappings[county] || {}, teams);
  return { teamMappings, competitionLookup, venueMappings, lookup };
}
export function makeRules(data) {
  const plain = createClubberRules({});
  const idx = buildLookupIndexes(data.lookup || {}, plain.normClubName || (s => s));
  return createClubberRules({ teamMappings: data.teamMappings, competitionLookup: data.competitionLookup,
    venueMappings: data.venueMappings, ...idx });
}
async function getRules(kv, deps) {
  if (_rulesMemo && Date.now() - _rulesMemo.at < RULES_TTL_MS) return _rulesMemo.rules;
  const rules = makeRules(await loadRulesData(kv, deps));
  _rulesMemo = { at: Date.now(), rules };
  return rules;
}

// ------------------------------------------------------------ fixture view
// The fixture list exactly as the dashboard builds it (worker GET, then
// loadFixtures / mergeFixtures / applyManualFixtures / applyOverrides in
// index.html), but with past fixtures kept so date ranges can look back.
export async function loadState(kv, deps) {
  const [base, statusMap, overrides, manual] = await Promise.all([
    deps.getAllCachedFixtures(kv), deps.getStatusMap(kv), deps.getOverridesMap(kv), deps.getManualFixtures(kv),
  ]);
  return { base, statusMap, overrides, manual };
}

export function buildView(R, state, deps) {
  const { base, statusMap, overrides, manual } = state;
  // Worker GET
  const fromGet = deps.deduplicateFixtures(base).map(f => {
    const key = deps.fixtureKey(f);
    const ov = overrides[key];
    return { ...f, ...(ov || {}), status: statusMap[key] || 'Proposed', statusKey: key };
  }).filter(f => f.status !== 'Removed');
  // loadFixtures: incoming
  const incoming = fromGet.map(f => ({ ...R.mk(f.county, f.teamA, f.teamB, f.date, f.time, f.venue, f.competition, f.round),
    code: f.code || R.deriveCode(f.competition, f.sport), status: f.status || 'Proposed',
    ...(f.clubberCreated !== undefined ? { clubberCreated: f.clubberCreated } : {}), ...(f.clubberGameId ? { clubberGameId: f.clubberGameId } : {}),
    ...(f.teamACounty ? { teamACounty: f.teamACounty } : {}), ...(f.teamBCounty ? { teamBCounty: f.teamBCounty } : {}),
    ...(f.teamACountySource ? { teamACountySource: f.teamACountySource } : {}), ...(f.teamBCountySource ? { teamBCountySource: f.teamBCountySource } : {}),
    ...(f.sourceUrl ? { sourceUrl: f.sourceUrl } : {}), ...(f.statusKey ? { statusKey: f.statusKey } : {}) }));
  // mergeFixtures
  const scraped = incoming.map(inc => {
    inc.county = R.normaliseCounty(inc.county);
    const origKey = inc.statusKey || R.keyOf(inc);
    return { ...inc, _origKey: origKey, _kind: 'scraped', id: 'f_' + b64url(origKey) };
  });
  // applyManualFixtures
  const manualView = [];
  for (const m of manual) {
    if (!m || typeof m !== 'object') continue;
    const mid = m.id ? String(m.id) : 'm' + Math.abs([...R.stableKeyOf(m)].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 0)).toString(36);
    const d = R.toIsoDate(m.date) || m.date;
    if ((m.status || '') === 'Removed') continue;
    manualView.push({ status: 'Proposed', ...m, id: 'm_' + mid, _manualId: mid, _kind: 'manual', manual: true, date: d, day: m.day || (isIsoDate(d) ? R.dayName(d) : '') });
  }
  const all = R.applyOverridesTo([...scraped, ...manualView], overrides);
  // The dashboard only holds upcoming fixtures; its "result pending" check
  // (teams still to be decided) looks at those
  const today = new Date().toISOString().slice(0, 10);
  R.setFixtures(all.filter(f => f.date >= today));
  return all;
}

// ------------------------------------------------------- public fixture JSON
function clubberToDublinTime(deps, g) {
  try { return deps.clubberToDublin(g.date, g.time); } catch { return null; }
}
export function toApiFixture(R, f, ctx) {
  let payloadRes;
  try { payloadRes = R.buildGamePayload(f); }
  catch (e) {
    // e.g. a date that isn't a real date - report it rather than fail the list
    payloadRes = { payload: null, errors: [`Clubber details can't be worked out: ${String((e && e.message) || e)}`], warnings: [] };
  }
  const rugby = R.isRugbyFixture(f) || (f.code || '').toLowerCase() === 'rugby';
  const t24 = R.from12h(f.time || '');
  const ovr = f._kind === 'scraped' ? (ctx.overrides[f._origKey] || {}) : {};
  const edited = f._kind === 'scraped' ? EDIT_FIELDS.filter(k => ovr[k] !== undefined) : [];
  const gameId = f.clubberGameId || '';
  let live = null, differences = [];
  if (gameId && ctx.gamesById) {
    const g = ctx.gamesById.get(gameId);
    if (g) {
      const c = clubberToDublinTime(ctx.deps, g);
      live = { date: c ? c.date : g.date, time: c && c.time ? c.time : null, site: g.site, grade: g.grade || '', price: g.price ?? null };
      if (c && c.date !== f.date) differences.push({ field: 'date', clubber: c.date, dashboard: f.date });
      if (c && (c.time || '') !== (t24 || '')) differences.push({ field: 'time', clubber: c.time || null, dashboard: t24 || null });
    }
  }
  const out = {
    id: f.id,
    kind: f._kind,
    status: f.status || 'Proposed',
    sport: rugby ? 'Rugby' : 'GAA',
    site: rugby ? 'UK' : 'IE',
    county: f.county || '',
    competition: f.competition || '',
    code: f.code || '',
    round: f.round || '',
    teamA: f.teamA || '',
    teamB: f.teamB || '',
    teamACounty: f.teamACounty || '',
    teamBCounty: f.teamBCounty || '',
    date: f.date || '',
    day: f.day || '',
    time: t24 || null,
    timeText: f.time || 'TBC',
    venue: f.venue || '',
    sourceUrl: f.sourceUrl || '',
    edited,
    missing: { date: R.isDateMissing(f), time: R.isTimeMissing(f), teams: R.isResultPending(f) },
    clubber: {
      created: !!f.clubberCreated,
      gameId: gameId || null,
      pick: !!f.clubberPick,
      hero: !!f.hero,
      ready: payloadRes.errors.length === 0,
      errors: payloadRes.errors,
      warnings: payloadRes.warnings,
      game: payloadRes.payload,
      live,
      differences,
    },
    crew: Object.fromEntries(CREW_FIELDS.map(k => [k, f[k] ?? null])),
  };
  return out;
}

// Content hash for change tracking (everything Clubber sees)
async function fixtureHash(apiF) {
  const { live, differences, ...clubberRest } = apiF.clubber;
  return (await sha256Hex(JSON.stringify({ ...apiF, clubber: clubberRest }))).slice(0, 24);
}

// ---------------------------------------------------------- change tracking
// Records when each fixture last changed (anything in its API JSON), so
// Clubber can ask "what changed since X" and the webhook can push it.
export async function refreshVersions(kv, apiFixtures, nowIso) {
  const versions = await readJsonKV(kv, VERSIONS_KEY, {});
  const first = !versions.__since;
  if (first) versions.__since = { at: nowIso };
  const seen = new Set(['__since']);
  const changes = [];
  let dirty = false;
  for (const a of apiFixtures) {
    seen.add(a.id);
    const h = await fixtureHash(a);
    const v = versions[a.id];
    if (!v || v.h !== h || v.gone) {
      const change = !v || v.gone ? 'created' : 'updated';
      versions[a.id] = { h, at: nowIso };
      changes.push({ id: a.id, change, at: nowIso });
      dirty = true;
    }
  }
  const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
  for (const [id, v] of Object.entries(versions)) {
    if (seen.has(id)) continue;
    if (!v.gone) { versions[id] = { h: '', at: nowIso, gone: true }; changes.push({ id, change: 'removed', at: nowIso }); dirty = true; }
    else if (Date.parse(v.at) < cutoff) { delete versions[id]; dirty = true; }
  }
  // The first run records the baseline: every fixture "changed" at that time
  if (dirty || first) await kv.put(VERSIONS_KEY, JSON.stringify(versions));
  return { versions, changes };
}

// ------------------------------------------------------------- full context
async function buildContext(kv, deps, opts = {}) {
  const [R, state] = await Promise.all([getRules(kv, deps), loadState(kv, deps)]);
  const view = buildView(R, state, deps);
  let gamesById = null;
  if (opts.withClubberFeed !== false) {
    try {
      const feed = JSON.parse(await deps.getClubberGames(kv));
      if (feed && feed.ok) gamesById = new Map((feed.games || []).map(g => [g.id, g]));
    } catch { /* live Clubber details are optional */ }
  }
  return { R, state, view, overrides: state.overrides, gamesById, deps };
}

function parseRange(params, { defaultAll = false } = {}) {
  let from = params.get('from'), to = params.get('to');
  if (from && !isIsoDate(from)) throw new ApiError(400, 'invalid_from', '`from` must be a date like 2026-11-20');
  if (to && !isIsoDate(to)) throw new ApiError(400, 'invalid_to', '`to` must be a date like 2026-12-20');
  if (!from && !to && defaultAll) return { from: null, to: null };
  if (!from) from = to ? addDays(to, -DEFAULT_RANGE_DAYS) : dublinToday();
  if (!to) to = addDays(from, DEFAULT_RANGE_DAYS);
  if (to < from) throw new ApiError(400, 'invalid_range', '`to` is before `from`');
  if (daysBetween(from, to) > MAX_RANGE_DAYS) throw new ApiError(400, 'range_too_long', `A request can cover at most ${MAX_RANGE_DAYS} days`);
  return { from, to };
}
function listParam(params, name) {
  const v = params.getAll(name).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean);
  return v.length ? v : null;
}
function filterFixtures(list, params, range) {
  const statuses = listParam(params, 'status');
  if (statuses) for (const s of statuses) if (![...STATUSES].includes(s)) throw new ApiError(400, 'invalid_status', `Unknown status "${s}" (use ${STATUSES.join(', ')})`);
  const site = params.get('site');
  if (site && !['IE', 'UK'].includes(site)) throw new ApiError(400, 'invalid_site', '`site` must be IE or UK');
  const counties = listParam(params, 'county'), codes = listParam(params, 'code');
  const q = (params.get('q') || '').trim().toLowerCase();
  const inClubber = params.get('inClubber');
  return list.filter(a => {
    if (range.from && !(a.date >= range.from)) return false;
    if (range.to && !(a.date <= range.to)) return false;
    if (statuses && !statuses.includes(a.status)) return false;
    if (site && a.site !== site) return false;
    if (counties && !counties.includes(a.county)) return false;
    if (codes && !codes.map(c => c.toLowerCase()).includes(a.code.toLowerCase())) return false;
    if (inClubber === 'true' && !a.clubber.created) return false;
    if (inClubber === 'false' && a.clubber.created) return false;
    if (q && ![a.teamA, a.teamB, a.venue, a.competition, a.county, a.round].join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}
const sortKey = a => `${a.date}|${a.time || '99:99'}|${a.county}|${a.teamA}`;
function paginate(list, params) {
  const limitRaw = params.get('limit');
  const limit = limitRaw ? Number(limitRaw) : DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new ApiError(400, 'invalid_limit', `\`limit\` must be 1-${MAX_LIMIT}`);
  let offset = 0;
  const cursor = params.get('cursor');
  if (cursor) {
    try { offset = Number(unb64url(cursor).replace(/^o:/, '')); } catch { offset = NaN; }
    if (!Number.isInteger(offset) || offset < 0) throw new ApiError(400, 'invalid_cursor', 'Bad `cursor`');
  }
  const page = list.slice(offset, offset + limit);
  const next = offset + limit < list.length ? b64url('o:' + (offset + limit)) : null;
  return { page, next, total: list.length };
}

// ------------------------------------------------------------------ history
function statusHistoryFor(hist, f) {
  // Same matching as the dashboard: county|competition|teamA|teamB, any date
  const k = f._kind === 'scraped' ? f._origKey : `${f.county}|${f.competition}|${f.teamA}|${f.teamB}|${f.date}`;
  const [c, comp, a, b] = k.split('|');
  return hist.filter(h => { const p = String(h.key || '').split('|'); return p[0] === c && p[1] === comp && p[2] === a && p[3] === b; });
}
function statusEntry(h) {
  const isPick = typeof h.status === 'string' && h.status.startsWith('Pick:');
  const isClubber = h.status === 'Clubber';
  return {
    type: isPick ? 'pick' : isClubber ? 'clubber' : 'status',
    at: h.timestamp, user: h.user || '', device: h.device || '',
    changes: [{ field: isPick ? 'Clubber Pick' : isClubber ? 'In Clubber' : 'Status',
      from: isPick ? String(h.previousStatus || '').replace('Pick: ', '') : isClubber ? 'No' : h.previousStatus ?? null,
      to: isPick ? h.status.replace('Pick: ', '') : isClubber ? 'Yes' : h.status }],
    note: '', key: h.key,
  };
}
function editEntry(e) {
  return { type: 'edit', at: e.timestamp, user: e.user || '', device: e.device || '',
    changes: (e.diffs || []).map(d => ({ field: d.field, from: d.from, to: d.to })), note: e.note || '', key: e.sk };
}

// ------------------------------------------------------------------- writes
function apiUserName(request, body) {
  const raw = (body && typeof body.user === 'string' && body.user) || request.headers.get('X-User-Name') || '';
  const name = raw.replace(/[\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return name ? `${name} (Clubber)` : 'Clubber';
}
function findFixture(view, id) {
  return view.find(f => f.id === id) || null;
}
function validatePatch(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new ApiError(400, 'invalid_body', 'Body must be a JSON object');
  const allowed = new Set(['status', 'user', ...EDIT_FIELDS, ...CLUBBER_FIELDS, ...CREW_FIELDS, 'id']);
  const unknown = Object.keys(p).filter(k => !allowed.has(k));
  if (unknown.length) throw new ApiError(400, 'unknown_fields', `Unknown field(s): ${unknown.join(', ')}`);
  if (p.status !== undefined && !STATUSES.includes(p.status)) throw new ApiError(400, 'invalid_status', `status must be one of ${STATUSES.join(', ')} (use DELETE to remove a Rejected fixture)`);
  if (p.date !== undefined && !isIsoDate(p.date)) throw new ApiError(400, 'invalid_date', 'date must be YYYY-MM-DD');
  if (p.time !== undefined && p.time !== null && p.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(p.time)) throw new ApiError(400, 'invalid_time', 'time must be HH:MM (24-hour, Irish time), or null for no time');
  for (const k of ['venue', 'round', 'competition', 'code', 'county', 'teamA', 'teamB', 'teamACounty', 'teamBCounty', ...CREW_FIELDS]) {
    if (p[k] !== undefined && p[k] !== null && typeof p[k] !== 'string' && !(k === 'cameras' && typeof p[k] === 'number')) throw new ApiError(400, 'invalid_field', `${k} must be a string`);
    if (typeof p[k] === 'string' && p[k].length > 300) throw new ApiError(400, 'invalid_field', `${k} is too long`);
  }
  for (const k of ['county', 'teamA', 'teamB']) if (p[k] !== undefined && !String(p[k] || '').trim()) throw new ApiError(400, 'invalid_field', `${k} can't be empty`);
  for (const k of ['clubberCreated', 'clubberPick', 'hero']) if (p[k] !== undefined && typeof p[k] !== 'boolean') throw new ApiError(400, 'invalid_field', `${k} must be true or false`);
  if (p.clubberGameId !== undefined && p.clubberGameId !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.clubberGameId)) throw new ApiError(400, 'invalid_field', 'clubberGameId must be a Clubber game ID (UUID)');
}

// Apply a list of {fixture, patch} in one read-modify-write of each KV key,
// saving exactly what the dashboard would save for the same action
async function applyWrites(kv, deps, R, items, user) {
  const now = new Date().toISOString();
  const [statusMap, history, overrides, manual, editHist] = await Promise.all([
    deps.getStatusMap(kv), deps.getStatusHistory(kv), deps.getOverridesMap(kv), deps.getManualFixtures(kv),
    readJsonKV(kv, deps.EDIT_HISTORY_KV_KEY, []),
  ]);
  const changed = new Set();
  const manualById = new Map(manual.map(m => [String(m.id), m]));
  const results = [];
  for (const { f, patch } of items) {
    const isManual = f._kind === 'manual';
    const mf = isManual ? manualById.get(f._manualId) : null;
    if (isManual && !mf) throw new ApiError(409, 'conflict', `Fixture ${f.id} changed while saving - try again`);
    const done = [];
    // --- edits (the dashboard's edit form)
    const base = { county: f.county, teamA: f.teamA, teamB: f.teamB, date: f.date, day: f.day, time: f.time, venue: f.venue || '',
      competition: f.competition || '', round: f.round || '', code: f.code || '', teamACounty: f.teamACounty || '', teamBCounty: f.teamBCounty || '' };
    const cand = {};
    for (const k of EDIT_FIELDS) {
      if (patch[k] === undefined) continue;
      if (k === 'time') cand.time = patch.time ? R.to12h(patch.time) : '';
      else cand[k] = typeof patch[k] === 'string' ? patch[k].replace(/\s+/g, ' ').trim() : '';
    }
    if (cand.date !== undefined) cand.day = R.dayName(cand.date);
    const structEdit = {};
    for (const [k, v] of Object.entries(cand)) if (v !== base[k]) structEdit[k] = v;
    if (Object.keys(structEdit).length) {
      if (isManual) {
        for (const [k, v] of Object.entries(structEdit)) {
          if ((k === 'teamACounty' || k === 'teamBCounty') && !v) delete mf[k]; else mf[k] = v;
        }
        changed.add('manual');
      } else {
        overrides[f._origKey] = Object.assign(overrides[f._origKey] || {}, structEdit);
        changed.add('ov');
      }
      const after = { ...f, ...structEdit };
      const diffs = Object.keys(structEdit).filter(k => k !== 'day').map(k => ({ field: FIELD_LABEL[k] || k, from: String(base[k] ?? ''), to: String(structEdit[k] ?? '') }));
      editHist.push({ sk: R.stableKeyOf(after), timestamp: now, user, device: API_DEVICE, diffs });
      changed.add('edits');
      done.push(...Object.keys(structEdit).filter(k => k !== 'day'));
    }
    // --- Clubber / crew fields
    const extra = {};
    for (const k of [...CLUBBER_FIELDS, ...CREW_FIELDS]) if (patch[k] !== undefined) extra[k] = patch[k] === null ? '' : patch[k];
    if (Object.keys(extra).length) {
      const prev = isManual ? mf : (overrides[f._origKey] || {});
      const statusKey = isManual ? R.keyOf(f) : f._origKey;
      if (extra.clubberCreated && !prev.clubberCreated) history.push({ key: statusKey, status: 'Clubber', previousStatus: 'Approved', timestamp: now, user, device: API_DEVICE });
      if (typeof extra.clubberPick === 'boolean' && extra.clubberPick !== !!prev.clubberPick) {
        history.push({ key: statusKey, status: extra.clubberPick ? 'Pick: Yes' : 'Pick: No', previousStatus: extra.clubberPick ? 'Pick: No' : 'Pick: Yes', timestamp: now, user, device: API_DEVICE });
      }
      if (isManual) { Object.assign(mf, extra); changed.add('manual'); }
      else { overrides[f._origKey] = Object.assign(overrides[f._origKey] || {}, extra); changed.add('ov'); }
      changed.add('hist');
      done.push(...Object.keys(extra));
    }
    // --- status (Approve / Reject / back to Proposed)
    if (patch.status !== undefined && patch.status !== f.status) {
      const key = isManual ? R.keyOf({ ...f, ...structEdit }) : f._origKey;
      history.push({ key, status: patch.status, previousStatus: statusMap[key] || (isManual ? f.status : 'Proposed') || 'Proposed', timestamp: now, user, device: API_DEVICE });
      statusMap[key] = patch.status;
      if (isManual) { mf.status = patch.status; changed.add('manual'); }
      changed.add('st'); changed.add('hist');
      done.push('status');
    }
    results.push({ id: f.id, changed: done });
  }
  return { statusMap, history, overrides, manual: [...manualById.values()], editHist, changed, now, results };
}
async function saveWrites(kv, deps, w) {
  const puts = [];
  const trim = (arr, max) => { if (arr.length > max) arr.splice(0, arr.length - max); return arr; };
  if (w.changed.has('st')) puts.push(kv.put(deps.STATUS_KV_KEY, JSON.stringify(w.statusMap)));
  if (w.changed.has('hist')) puts.push(kv.put(deps.STATUS_HISTORY_KV_KEY, JSON.stringify(trim(w.history, deps.STATUS_HISTORY_MAX))));
  if (w.changed.has('ov')) puts.push(kv.put(deps.OVERRIDES_KV_KEY, JSON.stringify(w.overrides)));
  if (w.changed.has('manual')) puts.push(kv.put(deps.MANUAL_KV_KEY, JSON.stringify(w.manual)));
  if (w.changed.has('edits')) puts.push(kv.put(deps.EDIT_HISTORY_KV_KEY, JSON.stringify(trim(w.editHist, deps.EDIT_HISTORY_MAX))));
  await Promise.all(puts);
}

// --------------------------------------------------------------- AI import
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function suggestMatches(R, view, row) {
  if (!row.teamA || !row.teamB || !isIsoDate(row.date)) return [];
  const a = norm(row.teamA), b = norm(row.teamB);
  const same = (x, y) => x && y && (x === y || (x.length >= 4 && y.length >= 4 && (` ${x} `.includes(` ${y} `) || ` ${y} `.includes(` ${x} `))));
  return view.filter(f => {
    if (!isIsoDate(f.date) || Math.abs(daysBetween(f.date, row.date)) > 42) return false;
    if (row.code && f.code && row.code.toLowerCase() !== f.code.toLowerCase()) return false;
    const fa = norm(f.teamA), fb = norm(f.teamB);
    return (same(a, fa) && same(b, fb)) || (same(a, fb) && same(b, fa));
  }).sort((x, y) => Math.abs(daysBetween(x.date, row.date)) - Math.abs(daysBetween(y.date, row.date)))
    .slice(0, 3).map(f => ({ id: f.id, status: f.status, date: f.date, time: R.from12h(f.time) || null, teamA: f.teamA, teamB: f.teamB, competition: f.competition }));
}

// ----------------------------------------------------------------- handler
async function authorise(request, env) {
  if (!env.CLUBBER_API_KEY) return apiError(503, 'not_configured', 'The Clubber API key has not been set up on the worker yet');
  const auth = request.headers.get('Authorization') || '';
  const key = request.headers.get('X-API-Key') || (auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!key || !(await safeEqual(key.trim(), env.CLUBBER_API_KEY))) return apiError(401, 'unauthorised', 'Missing or wrong API key');
  return null;
}
async function readBody(request) {
  const text = await request.text();
  if (text.length > 30 * 1024 * 1024) throw new ApiError(413, 'too_large', 'Request body is too large');
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new ApiError(400, 'invalid_json', 'Body is not valid JSON'); }
}

export function isClubberApiRequest(url) {
  return url.pathname === API_PREFIX || url.pathname.startsWith(API_PREFIX + '/');
}

export async function handleClubberApi(request, env, ctx, deps) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: API_CORS });
  const url = new URL(request.url);
  const path = url.pathname.slice(API_PREFIX.length).replace(/\/+$/, '') || '/';
  const kv = env.FIXTURE_STATUS;
  try {
    if (path === '/health' && request.method === 'GET') {
      return json({ ok: true, configured: !!env.CLUBBER_API_KEY, time: new Date().toISOString() });
    }
    const denied = await authorise(request, env);
    if (denied) return denied;
    if (!kv) throw new ApiError(500, 'kv_missing', 'Storage is not available');
    const params = url.searchParams;
    const m = path.match(/^\/fixtures\/([A-Za-z0-9_-]+)(\/history)?$/);

    // ---- GET /fixtures
    if (path === '/fixtures' && request.method === 'GET') {
      const range = parseRange(params);
      const c = await buildContext(kv, deps);
      const since = params.get('changedSince');
      if (since && isNaN(Date.parse(since))) throw new ApiError(400, 'invalid_since', '`changedSince` must be an ISO timestamp');
      const api = c.view.map(f => toApiFixture(c.R, f, c));
      let list = filterFixtures(api, params, range);
      const { versions } = await refreshVersions(kv, api, new Date().toISOString());
      list.forEach(a => { a.updatedAt = versions[a.id] ? versions[a.id].at : null; });
      if (since) list = list.filter(a => a.updatedAt && a.updatedAt > new Date(since).toISOString());
      list.sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
      const { page, next, total } = paginate(list, params);
      return json({ ok: true, from: range.from, to: range.to, total, nextCursor: next, fixtures: page });
    }

    // ---- POST /fixtures (add a fixture, like "Add fixture" on the dashboard)
    if (path === '/fixtures' && request.method === 'POST') {
      const body = await readBody(request);
      const user = apiUserName(request, body);
      for (const k of ['county', 'teamA', 'teamB', 'date']) if (!body[k] || typeof body[k] !== 'string' || !body[k].trim()) throw new ApiError(400, 'missing_field', `${k} is required`);
      validatePatch({ ...body, id: undefined });
      const R = await getRules(kv, deps);
      const manual = await deps.getManualFixtures(kv);
      const clean = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
      const nf = {
        id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        county: clean(body.county), teamA: clean(body.teamA), teamB: clean(body.teamB),
        date: body.date, day: R.dayName(body.date), time: body.time ? R.to12h(body.time) : '',
        venue: clean(body.venue), competition: clean(body.competition), round: clean(body.round),
        code: clean(body.code) || R.deriveCode(clean(body.competition), null), status: 'Proposed', manual: true, source: 'clubber-api',
        ...(clean(body.teamACounty) && clean(body.teamACounty) !== clean(body.county) ? { teamACounty: clean(body.teamACounty) } : {}),
        ...(clean(body.teamBCounty) && clean(body.teamBCounty) !== clean(body.county) ? { teamBCounty: clean(body.teamBCounty) } : {}),
      };
      const dup = manual.find(x => R.stableKeyOf(x) === R.stableKeyOf(nf) && (R.toIsoDate(x.date) || x.date) === nf.date && x.status !== 'Removed');
      if (dup) throw new ApiError(409, 'duplicate', 'That fixture already exists', { id: 'm_' + dup.id });
      manual.push(nf);
      await kv.put(deps.MANUAL_KV_KEY, JSON.stringify(manual));
      const editHist = await readJsonKV(kv, deps.EDIT_HISTORY_KV_KEY, []);
      editHist.push({ sk: R.stableKeyOf(nf), timestamp: new Date().toISOString(), user, device: API_DEVICE, note: `Manually created via Clubber API by ${user}`, diffs: [] });
      await kv.put(deps.EDIT_HISTORY_KV_KEY, JSON.stringify(editHist.slice(-deps.EDIT_HISTORY_MAX)));
      // Status / Clubber / crew fields given at creation: same path as PATCH
      const rest = Object.fromEntries(Object.entries(body).filter(([k]) => k === 'status' || CLUBBER_FIELDS.includes(k) || CREW_FIELDS.includes(k)));
      let c = await buildContext(kv, deps, { withClubberFeed: false });
      let f = findFixture(c.view, 'm_' + nf.id);
      if (Object.keys(rest).length && f) {
        const w = await applyWrites(kv, deps, c.R, [{ f, patch: rest }], user);
        await saveWrites(kv, deps, w);
        c = await buildContext(kv, deps, { withClubberFeed: false });
        f = findFixture(c.view, 'm_' + nf.id);
      }
      return json({ ok: true, fixture: f ? toApiFixture(c.R, f, c) : null }, 201);
    }

    // ---- POST /fixtures/batch  {updates: [{id, ...fields}], user}
    if (path === '/fixtures/batch' && request.method === 'POST') {
      const body = await readBody(request);
      const updates = Array.isArray(body.updates) ? body.updates : null;
      if (!updates || !updates.length) throw new ApiError(400, 'invalid_body', '`updates` must be a non-empty list');
      if (updates.length > 500) throw new ApiError(400, 'too_many', 'At most 500 updates per request');
      updates.forEach(u => validatePatch(u));
      const user = apiUserName(request, body);
      const c = await buildContext(kv, deps, { withClubberFeed: false });
      const items = updates.map(u => {
        const f = findFixture(c.view, String(u.id || ''));
        if (!f) throw new ApiError(404, 'not_found', `No fixture with id ${u.id}`);
        const { id, user: _u, ...patch } = u;
        return { f, patch };
      });
      const w = await applyWrites(kv, deps, c.R, items, user);
      await saveWrites(kv, deps, w);
      const c2 = await buildContext(kv, deps);
      return json({ ok: true, results: w.results.map(r => { const f = findFixture(c2.view, r.id); return { ...r, fixture: f ? toApiFixture(c2.R, f, c2) : null }; }) });
    }

    // ---- /fixtures/{id}[/history]
    if (m) {
      const id = m[1];
      if (m[2]) {
        if (request.method !== 'GET') throw new ApiError(405, 'method_not_allowed', 'Use GET');
        const c = await buildContext(kv, deps, { withClubberFeed: false });
        const f = findFixture(c.view, id);
        if (!f) throw new ApiError(404, 'not_found', `No fixture with id ${id}`);
        const [hist, edits] = await Promise.all([deps.getStatusHistory(kv), readJsonKV(kv, deps.EDIT_HISTORY_KV_KEY, [])]);
        const sk = c.R.stableKeyOf(f);
        const entries = [...statusHistoryFor(hist, f).map(statusEntry), ...edits.filter(e => e.sk === sk).map(editEntry)]
          .sort((a, b) => String(a.at).localeCompare(String(b.at)));
        return json({ ok: true, id, history: entries });
      }
      if (request.method === 'GET') {
        const c = await buildContext(kv, deps);
        const f = findFixture(c.view, id);
        if (!f) throw new ApiError(404, 'not_found', `No fixture with id ${id}`);
        const a = toApiFixture(c.R, f, c);
        const versions = await readJsonKV(kv, VERSIONS_KEY, {});
        a.updatedAt = versions[id] ? versions[id].at : null;
        return json({ ok: true, fixture: a });
      }
      if (request.method === 'PATCH') {
        const body = await readBody(request);
        validatePatch(body);
        const user = apiUserName(request, body);
        const c = await buildContext(kv, deps, { withClubberFeed: false });
        const f = findFixture(c.view, id);
        if (!f) throw new ApiError(404, 'not_found', `No fixture with id ${id}`);
        const { user: _u, id: _i, ...patch } = body;
        const w = await applyWrites(kv, deps, c.R, [{ f, patch }], user);
        await saveWrites(kv, deps, w);
        const c2 = await buildContext(kv, deps);
        const f2 = findFixture(c2.view, id);
        return json({ ok: true, changed: w.results[0].changed, fixture: f2 ? toApiFixture(c2.R, f2, c2) : null });
      }
      if (request.method === 'DELETE') {
        // The dashboard's "Remove": only for Rejected fixtures
        const body = await readBody(request).catch(() => ({}));
        const user = apiUserName(request, body);
        const c = await buildContext(kv, deps, { withClubberFeed: false });
        const f = findFixture(c.view, id);
        if (!f) throw new ApiError(404, 'not_found', `No fixture with id ${id}`);
        if (f.status !== 'Rejected') throw new ApiError(409, 'not_rejected', 'Only Rejected fixtures can be removed - reject it first');
        const [statusMap, history, manual] = await Promise.all([deps.getStatusMap(kv), deps.getStatusHistory(kv), deps.getManualFixtures(kv)]);
        const key = f._kind === 'scraped' ? f._origKey : c.R.keyOf(f);
        history.push({ key, status: 'Removed', previousStatus: statusMap[key] || f.status, timestamp: new Date().toISOString(), user, device: API_DEVICE });
        statusMap[key] = 'Removed';
        const puts = [kv.put(deps.STATUS_KV_KEY, JSON.stringify(statusMap)),
          kv.put(deps.STATUS_HISTORY_KV_KEY, JSON.stringify(history.slice(-deps.STATUS_HISTORY_MAX)))];
        if (f._kind === 'manual') puts.push(kv.put(deps.MANUAL_KV_KEY, JSON.stringify(manual.filter(x => String(x.id) !== f._manualId))));
        await Promise.all(puts);
        return json({ ok: true, id, removed: true });
      }
      throw new ApiError(405, 'method_not_allowed', 'Use GET, PATCH or DELETE');
    }

    // ---- GET /changes?since=ISO
    if (path === '/changes' && request.method === 'GET') {
      const since = params.get('since');
      if (!since || isNaN(Date.parse(since))) throw new ApiError(400, 'invalid_since', '`since` (ISO timestamp) is required, e.g. 2026-11-20T09:00:00Z');
      const range = parseRange(params, { defaultAll: true });
      const c = await buildContext(kv, deps);
      const nowIso = new Date().toISOString();
      const api = c.view.map(f => toApiFixture(c.R, f, c));
      const { versions } = await refreshVersions(kv, api, nowIso);
      const sinceIso = new Date(since).toISOString();
      const byId = new Map(api.map(a => [a.id, a]));
      const trackingSince = versions.__since.at;
      let changes = Object.entries(versions).filter(([id, v]) => id !== '__since' && v.at > sinceIso).map(([id, v]) => {
        const a = byId.get(id);
        if (a) a.updatedAt = v.at;
        return { id, change: v.gone ? 'removed' : 'changed', at: v.at, fixture: a || null };
      });
      if (range.from || range.to) changes = changes.filter(x => !x.fixture || ((!range.from || x.fixture.date >= range.from) && (!range.to || x.fixture.date <= range.to)));
      changes.sort((a, b) => a.at.localeCompare(b.at));
      const { page, next, total } = paginate(changes, params);
      // Before tracking started every fixture shows as changed - do a full load instead
      return json({ ok: true, since: sinceIso, asOf: nowIso, trackingSince, complete: sinceIso >= trackingSince,
        from: range.from, to: range.to, total, nextCursor: next, changes: page });
    }

    // ---- GET /history?from&to (dates the changes were made, Irish time)
    if (path === '/history' && request.method === 'GET') {
      const range = parseRange(params);
      const type = params.get('type');
      if (type && !['status', 'edit'].includes(type)) throw new ApiError(400, 'invalid_type', '`type` must be status or edit');
      const [hist, edits] = await Promise.all([deps.getStatusHistory(kv), readJsonKV(kv, deps.EDIT_HISTORY_KV_KEY, [])]);
      const dayOf = ts => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/Dublin' });
      let entries = [...(type === 'edit' ? [] : hist.map(statusEntry)), ...(type === 'status' ? [] : edits.map(editEntry))]
        .filter(e => { const d = dayOf(e.at); return d >= range.from && d <= range.to; })
        .sort((a, b) => String(a.at).localeCompare(String(b.at)));
      const { page, next, total } = paginate(entries, params);
      return json({ ok: true, from: range.from, to: range.to, total, nextCursor: next, history: page,
        note: 'Status history keeps the latest 500 changes; edit history the latest 2000.' });
    }

    // ---- POST /import  (read fixtures from screenshots / PDFs / text with Claude)
    if (path === '/import' && request.method === 'POST') {
      if (!env.ANTHROPIC_API_KEY) throw new ApiError(503, 'not_configured', 'Fixture reading is not set up on the worker');
      const body = await readBody(request);
      const files = Array.isArray(body.files) ? body.files : [];
      const texts = Array.isArray(body.texts) ? body.texts : [];
      if (!files.length && !texts.length) throw new ApiError(400, 'invalid_body', 'Send `files` (base64 images / PDFs) and/or `texts`');
      const c = await buildContext(kv, deps, { withClubberFeed: false });
      const knownCounties = [...new Set(c.view.map(f => f.county).filter(Boolean))].sort();
      let res;
      try { res = await deps.extractFixturesWithClaude(env, { files, texts, note: body.note, knownCounties }); }
      catch (e) { throw new ApiError(502, 'extract_failed', 'Could not read the fixtures: ' + String((e && e.message) || e)); }
      const rows = (res.fixtures || []).map(r => {
        const row = { ...r, county: c.R.normaliseCounty(r.county || ''), code: r.code || c.R.deriveCode(r.competition || '', null) || '' };
        return { ...row, matches: suggestMatches(c.R, c.view, row) };
      });
      return json({ ok: true, fixtures: rows, ...(res.notes ? { notes: res.notes } : {}) });
    }

    // ---- GET /reference
    if (path === '/reference' && request.method === 'GET') {
      const c = await buildContext(kv, deps, { withClubberFeed: false });
      const uniq = k => [...new Set(c.view.map(f => f[k]).filter(Boolean))].sort();
      return json({ ok: true, statuses: STATUSES, sites: ['IE', 'UK'], grades: c.R.CLUBBER_GRADES,
        counties: uniq('county'), codes: uniq('code'), editableFields: EDIT_FIELDS, clubberFields: CLUBBER_FIELDS, crewFields: CREW_FIELDS });
    }

    throw new ApiError(404, 'not_found', `No endpoint ${request.method} ${API_PREFIX}${path}`);
  } catch (e) {
    if (e instanceof ApiError) return apiError(e.status, e.code, e.message, e.details);
    console.error('Clubber API error', e);
    return apiError(500, 'server_error', String((e && e.message) || e));
  }
}

// ------------------------------------------------------------ cron: webhook
// Keeps change tracking current and, when CLUBBER_WEBHOOK_URL is set, posts
// the ids that changed since the last successful post.
export async function runClubberApiCron(env, deps) {
  const kv = env.FIXTURE_STATUS;
  if (!kv || !env.CLUBBER_API_KEY) return; // API not switched on yet
  const c = await buildContext(kv, deps);
  const nowIso = new Date().toISOString();
  const { versions } = await refreshVersions(kv, c.view.map(f => toApiFixture(c.R, f, c)), nowIso);
  if (!env.CLUBBER_WEBHOOK_URL) return;
  const state = await readJsonKV(kv, WEBHOOK_STATE_KEY, {});
  const since = state.lastSentAt || nowIso;
  if (!state.lastSentAt) { await kv.put(WEBHOOK_STATE_KEY, JSON.stringify({ lastSentAt: nowIso })); return; }
  const changes = Object.entries(versions).filter(([id, v]) => id !== '__since' && v.at > since)
    .map(([id, v]) => ({ id, change: v.gone ? 'removed' : 'changed', at: v.at }));
  if (!changes.length) { await kv.put(WEBHOOK_STATE_KEY, JSON.stringify({ lastSentAt: nowIso })); return; }
  const body = JSON.stringify({ event: 'fixtures.changed', since, asOf: nowIso, count: changes.length, changes: changes.slice(0, 1000),
    truncated: changes.length > 1000 });
  const headers = { 'Content-Type': 'application/json', 'User-Agent': 'FixturesDashboard-Webhook/1' };
  if (env.CLUBBER_WEBHOOK_SECRET) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.CLUBBER_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
    headers['X-Fixtures-Signature'] = 'sha256=' + [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    const r = await fetch(env.CLUBBER_WEBHOOK_URL, { method: 'POST', headers, body });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    await kv.put(WEBHOOK_STATE_KEY, JSON.stringify({ lastSentAt: nowIso }));
  } catch (e) {
    console.error('Clubber webhook failed - will resend next hour', e); // lastSentAt unchanged
  }
}
