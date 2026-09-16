// Cloudflare Worker: scrapes Cork, Waterford, Laois, Wexford, Kerry, Offaly,
// Tipperary, Roscommon and Kilkenny GAA fixture pages server-side (avoiding
// browser CORS restrictions), fetches Longford via the Foireann Open Data API
// (requires FOIREANN_API_KEY env var), merges in Kildare's and Carlow's
// manually-transcribed static fixtures, and returns normalized JSON for the
// fixtures dashboard.

const UA = 'Mozilla/5.0 (compatible; FixturesDashboardBot/1.0)';

const CORK_COMPETITIONS = [
  { id: '215986', name: 'Premier Senior HC' },
  { id: '215987', name: 'Senior A HC' },
  { id: '215994', name: 'Premier Intermediate HC' },
  { id: '215995', name: 'Intermediate A HC' },
  { id: '215996', name: 'Premier Junior HC' },
  { id: '215997', name: 'Junior A HC' },
  { id: '215998', name: 'Junior B HC' },
  { id: '215999', name: 'Premier Senior FC' },
  { id: '216000', name: 'Senior A FC' },
  { id: '216005', name: 'Premier Intermediate FC' },
  { id: '216006', name: 'Intermediate A FC' },
  { id: '216007', name: 'Premier Junior FC' },
  { id: '216008', name: 'Junior A FC' },
];

const WATERFORD_COMPETITIONS = [
  { id: '214352', name: 'Senior HC Group A' },
  { id: '214353', name: 'Senior HC Group B' },
  { id: '214355', name: 'Premier Intermediate HC Group A' },
  { id: '214354', name: 'Premier Intermediate HC Group B' },
  { id: '218650', name: 'Junior A Hurling Championship' },
  { id: '218649', name: 'Junior C Hurling Championship' },
  { id: '214349', name: 'Senior FC Group A' },
  { id: '214348', name: 'Senior FC Group B' },
  { id: '214351', name: 'Premier Intermediate FC Group A' },
  { id: '214350', name: 'Premier Intermediate FC Group B' },
  { id: '218915', name: 'Intermediate FC' },
  { id: '219169', name: 'Junior B/C HC' },
  { id: '219171', name: 'Junior B/C HC Cup' },
];


const MONTHS = {
  Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April',
  May: 'May', Jun: 'June', Jul: 'July', Aug: 'August',
  Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December',
};

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/�/g, '') // strip Unicode replacement chars (U+FFFD) from mojibake
    .replace(/['']/g, "'") // normalise curly apostrophes to straight
    .replace(/\s*&\s*/g, ' & '); // ensure spaces around & in team/venue names
}

// "31 Jul 2026" -> "31 July 2026"
function shortDateToFull(d) {
  const [day, mon, year] = d.trim().split(' ');
  return `${parseInt(day, 10)} ${MONTHS[mon] || mon} ${year}`;
}

// "Friday 10th Jul 2026" -> "10 July 2026"
function laoisDateToFull(d) {
  const parts = d.trim().split(/\s+/); // ['Friday','10th','Jul','2026']
  const day = parseInt(parts[1], 10);
  const mon = MONTHS[parts[2]] || parts[2];
  const year = parts[3];
  return `${day} ${mon} ${year}`;
}

// ---- SportLoMo parser (Cork + Waterford share this CMS) ----
const SPORTLOMO_ROW_RE =
  /class="table-body fixtures-\d+ mobile-view"[^>]*data-date="([^"]*)"\s+data-time="([^"]*)"\s+data-hometeam="([^"]*)"\s+data-awayteam="([^"]*)"\s+data-homescore="[^"]*"\s+data-awayscore="[^"]*"\s+data-referee="[^"]*"\s+data-comment="([^"]*)"\s+data-venue="([^"]*)"\s+data-compname="([^"]*)"/g;

function parseSportLomoRows(html) {
  const rows = [];
  let m;
  const re = new RegExp(SPORTLOMO_ROW_RE);
  while ((m = re.exec(html))) {
    rows.push({
      date: m[1],
      time: m[2],
      home: decodeEntities(m[3]),
      away: decodeEntities(m[4]),
      comment: decodeEntities(m[5]),
      venue: decodeEntities(m[6]),
      compname: decodeEntities(m[7]),
      index: m.index,
    });
  }
  return rows;
}

// Cork standings tables contain <h3>Group N</h3> followed by team rows.
// We use this to map each team name → its group label as a round fallback.
function parseCorkGroupMap(html) {
  const map = {};
  const groupRe = /<h3>Group (\d+)<\/h3>([\s\S]*?)(?=<h3>Group \d+<\/h3>|$)/g;
  let gm;
  while ((gm = groupRe.exec(html))) {
    const block = gm[2];
    const teamRe = /class="Team" data-title="Team">(?:<a[^>]*>)?([^<]+)/g;
    let tm;
    while ((tm = teamRe.exec(block))) {
      map[decodeEntities(tm[1].trim())] = `Group ${gm[1]}`;
    }
  }
  return map;
}

async function fetchCorkCompetition(comp) {
  const url = `https://gaacork.ie/league/${comp.id}/`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Cork ${comp.id} fetch failed: ${res.status}`);
  const html = await res.text();
  const rows = parseSportLomoRows(html);
  const groupMap = parseCorkGroupMap(html);
  return rows.map((r) => ({
    county: 'Cork',
    teamA: r.home,
    teamB: r.away,
    date: shortDateToFull(r.date),
    time: r.time,
    venue: r.venue,
    competition: comp.name,
    // data-comment holds knockout stage labels ("Quarter Final", "Relegation Play-Off");
    // group-stage games have empty comment so fall back to the standings-derived group label.
    round: r.comment || groupMap[r.home] || '',
  }));
}

async function fetchWaterfordCompetition(comp) {
  const url = `https://www.waterfordgaa.ie/league/${comp.id}/`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Waterford ${comp.id} fetch failed: ${res.status}`);
  const html = await res.text();
  const rows = parseSportLomoRows(html);
  return rows.map((r) => ({
    county: 'Waterford',
    teamA: r.home,
    teamB: r.away,
    date: shortDateToFull(r.date),
    time: r.time,
    venue: r.venue,
    competition: comp.name,
    round: (r.comment || '').replace(/^(?:Round|Rd\.?)\s*(\d+)$/i, 'R$1'),
  }));
}

// ---- ClubAndCounty parser (Laois + Wexford share this CMS: paginated ----
// ---- AJAX feed of fixture cards, different markup from SportLoMo)     ----
const CAC_TOKEN_RE =
  /(fix_res_date py-2 text-center mb-0">([^<]*)<)|(competition-name flex-fill text-center p-2">\s*<a[^>]*>([^<]*)<\/a>)|(home_team col text-center text-md-right align-self-center">\s*<a[^>]*>\s*([^<]*?)\s*<\/a>)|(class="time rounded[^"]*">\s*([^<]*?)\s*<\/div>)|(away_team col text-center text-md-left align-self-center">\s*<a[^>]*>\s*([^<]*?)\s*<\/a>)|(<strong>Venue:<\/strong>\s*<a[^>]*>([^<]*)<\/a>)/g;

function classifyCacComp(compRaw, targets) {
  if (/Junior/i.test(compRaw)) return null;
  for (const t of targets) {
    if (compRaw.includes(t.match)) {
      let competition = t.name;
      const groupMatch = compRaw.match(/Group\s+([AB])/);
      if (groupMatch) competition += ` Group ${groupMatch[1]}`;
      const roundMatch = compRaw.match(/(?:Round|Rd\.?)\s+(\d+)/i);
      const round = roundMatch ? `R${roundMatch[1]}` : '';
      return { competition, round };
    }
  }
  return null;
}

function emptyBuf() {
  return { home: undefined, time: undefined, away: undefined, venue: undefined };
}

function parseCacHtml(html, out, county, targets) {
  let curDate = null;
  let curComp = null;
  let buf = emptyBuf();
  const re = new RegExp(CAC_TOKEN_RE);
  let m;
  while ((m = re.exec(html))) {
    if (m[2] !== undefined) {
      curDate = m[2].trim();
    } else if (m[4] !== undefined) {
      curComp = decodeEntities(m[4].trim().replace(/\s+/g, ' '));
      buf = emptyBuf();
    } else if (m[6] !== undefined) {
      buf = emptyBuf();
      buf.home = decodeEntities(m[6].trim());
    } else if (m[8] !== undefined) {
      buf.time = m[8].trim();
    } else if (m[10] !== undefined) {
      buf.away = decodeEntities(m[10].trim());
    } else if (m[12] !== undefined) {
      buf.venue = decodeEntities(m[12].trim());
      const cls = classifyCacComp(curComp || '', targets);
      if (cls && buf.home && buf.away) {
        out.push({
          county,
          teamA: buf.home,
          teamB: buf.away,
          date: laoisDateToFull(curDate),
          time: buf.time,
          venue: buf.venue,
          competition: cls.competition,
          round: cls.round,
        });
      }
      buf = emptyBuf();
    }
  }
}

async function fetchCacCounty(county, baseUrl, targets, debug) {
  const out = [];
  let page = 0;
  let hasMore = true;
  const seen = new Set();
  // Cloudflare's free plan caps a single Worker invocation at 50
  // subrequests total (across every county fetched), so page size and the
  // page-count ceiling here are tuned to leave headroom for the other
  // counties' fetches in the same request.
  while (hasMore && page < 6) {
    const url = `${baseUrl}?ajax=1&feed_type=fixtures&page=${page}&size=100`;
    let res, bodyText, json;
    try {
      res = await fetch(url, {
        headers: {
          'User-Agent': UA,
          Accept: 'application/json',
          Referer: baseUrl,
        },
      });
    } catch (err) {
      debug.push({ county, page, stage: 'fetch-threw', error: String(err) });
      break;
    }
    if (!res.ok) {
      debug.push({ county, page, stage: 'http-error', status: res.status });
      break;
    }
    bodyText = await res.text();
    try {
      json = JSON.parse(stripBom(bodyText));
    } catch (err) {
      debug.push({ county, page, stage: 'json-parse-failed', status: res.status, bodySnippet: bodyText.slice(0, 300) });
      break;
    }
    if (!json.ok) {
      debug.push({ county, page, stage: 'json-not-ok', bodySnippet: bodyText.slice(0, 300) });
      break;
    }
    const before = out.length;
    parseCacHtml(json.html, out, county, targets);
    debug.push({ county, page, stage: 'ok', htmlLength: json.html.length, newRows: out.length - before, hasMore: json.hasMore });
    hasMore = !!json.hasMore;
    page++;
  }
  // de-dupe (the feed can repeat the boundary date across consecutive pages)
  const deduped = [];
  for (const f of out) {
    const key = `${f.competition}|${f.teamA}|${f.teamB}|${f.date}|${f.time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(f);
  }
  return deduped;
}

// ---- Kerry (kerrygaa.ie): same ClubAndCounty CMS as Laois/Wexford, but
// unlike those two sites, kerrygaa.ie's AJAX feed actually honours the
// `competition=<uuid>` query param, so each competition can be fetched
// directly and precisely (fixtures feed + results feed) without needing
// pagination through the whole site's unfiltered feed.
function parseCacHtmlDirect(html, out, county, competitionName) {
  // Pre-pass: extract competition headings with their character positions.
  // Done separately from CAC_TOKEN_RE because the heading text spans multiple
  // lines and [^<]* inside a large alternation can silently fail to cross
  // newlines in Cloudflare's V8. [\s\S]*? is explicit and reliable here.
  const compPositions = [];
  {
    const cpRe = /competition-name[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/g;
    let cm;
    while ((cm = cpRe.exec(html))) {
      compPositions.push({ idx: cm.index, text: cm[1].trim().replace(/\s+/g, ' ') });
    }
  }

  let curDate = null;
  let curComp = null;
  let buf = emptyBuf();
  const re = new RegExp(CAC_TOKEN_RE);
  let m;
  while ((m = re.exec(html))) {
    // Update curComp to the most recent competition heading before this position
    for (const cp of compPositions) {
      if (cp.idx > m.index) break;
      curComp = cp.text;
    }
    if (m[2] !== undefined) {
      curDate = m[2].trim();
    } else if (m[4] !== undefined) {
      // Competition match from main regex — keep buf reset behaviour but
      // curComp is now managed by the pre-pass lookup above.
      buf = emptyBuf();
    } else if (m[6] !== undefined) {
      buf = emptyBuf();
      buf.home = decodeEntities(m[6].trim());
    } else if (m[8] !== undefined) {
      buf.time = m[8].trim();
    } else if (m[10] !== undefined) {
      buf.away = decodeEntities(m[10].trim());
    } else if (m[12] !== undefined) {
      buf.venue = decodeEntities(m[12].trim());
      // "BYE" entries are auto-generated placeholders for odd team counts
      // in a group/round, not real fixtures — skip them.
      if (buf.home && buf.away && buf.home !== 'BYE' && buf.away !== 'BYE') {
        let competition = competitionName;
        // Different counties label sub-groups/stages differently: Kerry
        // uses "Group N", Offaly "League Division N", Tipperary often has
        // knockout stages ("Quarter Final", "Semi Final", "Final") instead
        // of numbered rounds.
        const compStr = curComp || '';
        const groupMatch = compStr.match(/(?:Group|Division)\s+(\w+)/i);
        if (groupMatch) competition += ` Group ${groupMatch[1]}`;
        const roundMatch = compStr.match(/(?:Round|Rd\.?)\s+(\d+)/i);
        let round = roundMatch ? `R${roundMatch[1]}` : '';
        if (!round) {
          // Fallback: use whatever follows the last " - " separator as the
          // stage label (e.g. "Quarter Final 2", "Semi-Final", "Final").
          const parts = compStr.split(' - ');
          if (parts.length > 1) round = parts[parts.length - 1].trim();
        }
        // If this is a relegation competition, prefix the stage with "Rel"
        // and abbreviate the knockout stage (e.g. "Rel SF", "Rel F", "Rel QF").
        if (/relegation/i.test(compStr) || /relegation/i.test(competition)) {
          const stageAbbr = round
            .replace(/quarter[\s-]?final/i, 'QF')
            .replace(/semi[\s-]?final/i, 'SF')
            .replace(/\bfinal\b/i, 'F');
          round = `Rel${stageAbbr ? ' ' + stageAbbr : ''}`.trim();
        }
        out.push({
          county,
          teamA: buf.home,
          teamB: buf.away,
          date: laoisDateToFull(curDate),
          time: buf.time,
          venue: buf.venue,
          competition,
          round,
          _rawComp: curComp || '',
        });
      }
      buf = emptyBuf();
    }
  }
}

// Some sites (e.g. tipperary.gaa.ie) prefix their JSON responses with a
// literal UTF-8 BOM character, which JSON.parse rejects as invalid syntax.
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

async function fetchCacDirectCompetition(county, baseDomain, comp, debug) {
  const baseUrl = `https://${baseDomain}${comp.path}`;
  const out = [];
  // Only fetch upcoming fixtures, not past results — matches every other
  // county (Cork/Waterford/Laois/Wexford only ever surface upcoming
  // fixtures), and halves the subrequest cost of each competition, which
  // matters under Cloudflare's free 50-subrequest-per-invocation cap now
  // that there are many competitions across many counties in one request.
  for (const feedType of ['fixtures']) {
    const url = `${baseUrl}?ajax=1&feed_type=${feedType}&page=0&size=100&sport=${comp.sport}&level=${comp.level}&grade=${comp.grade}&competition=${comp.uuid}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: baseUrl },
      });
      if (!res.ok) {
        debug.push({ county, feedType, stage: 'http-error', status: res.status });
        continue;
      }
      const bodyText = await res.text();
      const json = JSON.parse(stripBom(bodyText));
      if (!json.ok) {
        debug.push({ county, feedType, stage: 'json-not-ok' });
        continue;
      }
      parseCacHtmlDirect(json.html, out, county, comp.name);
      debug.push({ county, feedType, stage: 'ok', hasMore: json.hasMore, rows: out.length });
    } catch (err) {
      debug.push({ county, feedType, stage: 'fetch-threw', error: String(err) });
    }
  }
  return out;
}

// Strip leading sponsor prefix from a competition name (display text or slug words).
// Finds the first recognisable GAA/competition term and drops everything before it
// so "St Canices Credit Union Senior Hurling League Group A" → "Senior Hurling League Group A".
// Also includes abbreviated terms (snr, jnr, premier) so we don't accidentally skip
// qualifier words that precede the sport noun.
function cacStripSponsor(s) {
  const gaaFirst = s.search(/\b(senior|snr|intermediate|premier|junior|jnr|section|division|div\b|all[\s-]co|championship|league|cup|football|hurling|camogie|ladies[\s-]football|shield|plate|trophy|county|provincial|grade)\b/i);
  return gaaFirst > 0 ? s.slice(gaaFirst) : s;
}

// Abbreviation expansion map for counties that use shorthand in option text
// (e.g. meath.gaa.ie uses "2026 - SFC - Fairyhouse Steel" style option text).
const CAC_COMP_ABBREVS = {
  'SFC': 'Senior Football Championship',    'SFC B': 'Senior Football Championship B',
  'IFC': 'Intermediate Football Championship', 'IFC B': 'Intermediate Football Championship B',
  'JFC': 'Junior Football Championship',    'JFC B': 'Junior B Football Championship',
  'JBFC': 'Junior B Football Championship', 'RFC': 'Reserve Football Championship',
  'SHC': 'Senior Hurling Championship',     'SHC B': 'Senior Hurling Championship B',
  'IHC': 'Intermediate Hurling Championship', 'IHC B': 'Intermediate Hurling Championship B',
  'JHC': 'Junior Hurling Championship',     'JHC B': 'Junior B Hurling Championship',
  'JBHC': 'Junior B Hurling Championship',
  'IACFC': 'Intermediate A Football Championship',
  'JACFC': 'Junior A Football Championship',
};

// Name from the option element's display text (preferred — includes sport type
// which the URL slug may omit, e.g. "JJ Kavanagh Premier Junior Hurling Championship").
// sport is passed so we can inject it when the option text omits it
// (e.g. "JJ Kavanagh Premier Jnr Championship" → "Premier Junior Hurling Championship").
// Also handles "YEAR - ABBREV - Sponsor" format used by meath.gaa.ie.
function cacCompNameFromText(text, sport) {
  let s = (text || '').trim();

  // Strip leading year prefix "2026 - " or "2025 - " etc.
  s = s.replace(/^\d{4}\s*[-–]\s*/, '');

  // Expand known competition abbreviation at start (e.g. "SFC - Fairyhouse Steel" → "Senior Football Championship")
  const abbrevM = s.match(/^([A-Z]{2,6}(?:\s+[AB])?)(?:\s*[-–]\s*.*)?$/);
  if (abbrevM && CAC_COMP_ABBREVS[abbrevM[1].trim()]) {
    s = CAC_COMP_ABBREVS[abbrevM[1].trim()];
  } else {
    // Strip leading sponsor prefix (anything before first GAA keyword)
    s = cacStripSponsor(s);
    // Strip trailing sponsor suffix " - Sponsor Name" (e.g. "Senior FC - Fairyhouse Steel")
    s = s.replace(/\s*[-–]\s+[A-Z][\w\s,'&.]+$/, '').trim();
    // Normalise "Div." punctuation
    s = s.replace(/\bDiv\.\s*/g, 'Div ').trim();
  }

  s = s
    .replace(/\bSnr\b/g, 'Senior')
    .replace(/\bSen\b/g, 'Senior')
    .replace(/\bJnr\b/g, 'Junior')
    .replace(/\bGaa\b/g, 'GAA')
    .replace(/\bFod\b/g, 'FOD')
    .trim();
  // Inject sport type if not already present so name matches historic KV keys
  // (e.g. "Premier Junior Championship" → "Premier Junior Hurling Championship")
  if (sport && !/hurling|football|camogie|ladies/i.test(s)) {
    const sportTitle = sport.charAt(0).toUpperCase() + sport.slice(1);
    s = s.replace(/\b(Championship|League|Cup|Shield|Plate|Trophy)\b/, `${sportTitle} $1`);
  }
  return s;
}

// Fallback name from CAC URL slug when no display text is available.
function cacCompNameFromPath(path) {
  const slug = path.split('/').filter(Boolean).slice(-2, -1)[0] || '';
  let s = slug
    .replace(/^20\d\d-/, '')
    .replace(/-20\d\d$/, '')
    .replace(/-/g, ' ');
  s = cacStripSponsor(s);
  return s
    .replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bGaa\b/, 'GAA')
    .replace(/\bFod\b/, 'FOD')
    .replace(/\bJnr\b/, 'Junior')
    .replace(/\bSnr\b/, 'Senior')
    .trim();
}

// Generic CAC competition discovery.
// These sites render all competitions as <option data-uuid="..." data-sport="..."
// data-level="club" data-grade="..." value="slug"> elements in a filter dropdown.
// A single listing page fetch returns ALL competitions for the domain.
// compNameFn(path, grade) is optional; defaults to cacCompNameFromPath.
async function fetchCacCountyCompetitions(domain, listingPages, compNameFn) {
  const nameFn = compNameFn || cacCompNameFromPath;
  const seen = new Set();
  const comps = [];
  // Only need one page — the full site HTML is returned regardless of filter URL.
  const url = listingPages[0].url;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return comps;
    const html = await res.text();
    // Capture attrs AND the display text between > and </option> so we can use
    // the full name (e.g. "JJ Kavanagh Premier Junior Hurling Championship") and
    // strip only the sponsor prefix rather than guessing from the URL slug.
    const optRe = /<option\b([^>]+)>([^<]*)<\/option>/g;
    let m;
    while ((m = optRe.exec(html)) !== null) {
      const attrs = m[1];
      const optText = m[2].trim();
      const uuidM = attrs.match(/data-uuid="([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/);
      if (!uuidM) continue;
      const uuid = uuidM[1];
      if (seen.has(uuid)) continue;
      const levelM = attrs.match(/data-level="([^"]+)"/);
      if (!levelM || levelM[1] !== 'club') continue;
      const sportM = attrs.match(/data-sport="([^"]+)"/);
      const gradeM = attrs.match(/data-grade="([^"]+)"/);
      const valueM = attrs.match(/value="([^"]+)"/);
      if (!sportM || !gradeM || !valueM) continue;
      const cSport = sportM[1];
      const cGrade = gradeM[1];
      const slug = valueM[1];
      // Skip underage competitions (u14, u14b, u-14, under-14, minor, juvenile…)
      const underageRe = /\b(minor|underage|u\d+\w*|under.?\d+|feile|bainne|primary|juvenile|youth)\b/i;
      if (underageRe.test(slug) || underageRe.test(cGrade) || underageRe.test(optText)) continue;
      seen.add(uuid);
      const path = `/fixtures-results/${cSport}/club/${cGrade}/${slug}/${uuid}/`;
      // Prefer the option display text (includes sport type the slug may omit).
      const name = optText ? cacCompNameFromText(optText, cSport) : nameFn(path, cGrade);
      comps.push({ path, uuid, sport: cSport, level: 'club', grade: cGrade, name });
    }
  } catch (_) {}
  return comps;
}

function fetchKilkennyCompetitions() {
  return fetchCacCountyCompetitions('kilkennygaa.ie', [
    { url: 'https://kilkennygaa.ie/fixtures-results/hurling/club/senior/',       sport: 'hurling',  level: 'club', grade: 'senior' },
    { url: 'https://kilkennygaa.ie/fixtures-results/hurling/club/intermediate/', sport: 'hurling',  level: 'club', grade: 'intermediate' },
    { url: 'https://kilkennygaa.ie/fixtures-results/hurling/club/junior/',        sport: 'hurling',  level: 'club', grade: 'junior' },
    { url: 'https://kilkennygaa.ie/fixtures-results/football/club/senior/',       sport: 'football', level: 'club', grade: 'senior' },
    { url: 'https://kilkennygaa.ie/fixtures-results/football/club/junior/',       sport: 'football', level: 'club', grade: 'junior' },
  ]);
}

function fetchKilkennyAmogieCompetitions() {
  return fetchCacCountyCompetitions('kilkennycamogie.ie', [
    { url: 'https://kilkennycamogie.ie/fixtures-results/camogie/club/senior/',       sport: 'camogie', level: 'club', grade: 'senior' },
    { url: 'https://kilkennycamogie.ie/fixtures-results/camogie/club/intermediate/', sport: 'camogie', level: 'club', grade: 'intermediate' },
    { url: 'https://kilkennycamogie.ie/fixtures-results/camogie/club/junior/',        sport: 'camogie', level: 'club', grade: 'junior' },
  ]);
}

function fetchLaoisCompetitions() {
  return fetchCacCountyCompetitions('laoisgaa.ie', [
    { url: 'https://laoisgaa.ie/fixtures-results/football/club/senior/',       sport: 'football', level: 'club', grade: 'senior' },
    { url: 'https://laoisgaa.ie/fixtures-results/football/club/intermediate/', sport: 'football', level: 'club', grade: 'intermediate' },
    { url: 'https://laoisgaa.ie/fixtures-results/football/club/junior/',        sport: 'football', level: 'club', grade: 'junior' },
    { url: 'https://laoisgaa.ie/fixtures-results/hurling/club/senior/',        sport: 'hurling',  level: 'club', grade: 'senior' },
    { url: 'https://laoisgaa.ie/fixtures-results/hurling/club/intermediate/',  sport: 'hurling',  level: 'club', grade: 'intermediate' },
    { url: 'https://laoisgaa.ie/fixtures-results/hurling/club/junior/',         sport: 'hurling',  level: 'club', grade: 'junior' },
  ]);
}

function fetchWexfordCompetitions() {
  return fetchCacCountyCompetitions('wexford.clubandcounty.com', [
    { url: 'https://wexford.clubandcounty.com/fixtures-results/football/club/senior/',       sport: 'football', level: 'club', grade: 'senior' },
    { url: 'https://wexford.clubandcounty.com/fixtures-results/football/club/intermediate/', sport: 'football', level: 'club', grade: 'intermediate' },
    { url: 'https://wexford.clubandcounty.com/fixtures-results/football/club/junior/',        sport: 'football', level: 'club', grade: 'junior' },
    { url: 'https://wexford.clubandcounty.com/fixtures-results/hurling/club/senior/',        sport: 'hurling',  level: 'club', grade: 'senior' },
    { url: 'https://wexford.clubandcounty.com/fixtures-results/hurling/club/intermediate/',  sport: 'hurling',  level: 'club', grade: 'intermediate' },
    { url: 'https://wexford.clubandcounty.com/fixtures-results/hurling/club/junior/',         sport: 'hurling',  level: 'club', grade: 'junior' },
  ]);
}

function fetchMonaghanCompetitions() {
  return fetchCacCountyCompetitions('www.monaghangaa.ie', [
    { url: 'https://www.monaghangaa.ie/fixtures-results/football/club/senior/',       sport: 'football', level: 'club', grade: 'senior' },
    { url: 'https://www.monaghangaa.ie/fixtures-results/football/club/intermediate/', sport: 'football', level: 'club', grade: 'intermediate' },
    { url: 'https://www.monaghangaa.ie/fixtures-results/football/club/junior/',        sport: 'football', level: 'club', grade: 'junior' },
    { url: 'https://www.monaghangaa.ie/fixtures-results/hurling/club/senior/',        sport: 'hurling',  level: 'club', grade: 'senior' },
    { url: 'https://www.monaghangaa.ie/fixtures-results/hurling/club/intermediate/',  sport: 'hurling',  level: 'club', grade: 'intermediate' },
  ]);
}

function fetchMeathCompetitions() {
  return fetchCacCountyCompetitions('meath.gaa.ie', [
    { url: 'https://meath.gaa.ie/fixtures-results/football/club/senior/',       sport: 'football', level: 'club', grade: 'senior' },
    { url: 'https://meath.gaa.ie/fixtures-results/football/club/intermediate/', sport: 'football', level: 'club', grade: 'intermediate' },
    { url: 'https://meath.gaa.ie/fixtures-results/football/club/junior/',        sport: 'football', level: 'club', grade: 'junior' },
    { url: 'https://meath.gaa.ie/fixtures-results/hurling/club/senior/',        sport: 'hurling',  level: 'club', grade: 'senior' },
    { url: 'https://meath.gaa.ie/fixtures-results/hurling/club/intermediate/',  sport: 'hurling',  level: 'club', grade: 'intermediate' },
    { url: 'https://meath.gaa.ie/fixtures-results/hurling/club/junior/',         sport: 'hurling',  level: 'club', grade: 'junior' },
  ]);
}

function fetchOffalyCompetitions() {
  return fetchCacCountyCompetitions('offaly.gaa.ie', [
    { url: 'https://offaly.gaa.ie/fixtures-results/football/club/senior/',       sport: 'football', level: 'club', grade: 'senior' },
    { url: 'https://offaly.gaa.ie/fixtures-results/football/club/intermediate/', sport: 'football', level: 'club', grade: 'intermediate' },
    { url: 'https://offaly.gaa.ie/fixtures-results/football/club/junior/',        sport: 'football', level: 'club', grade: 'junior' },
    { url: 'https://offaly.gaa.ie/fixtures-results/hurling/club/senior/',        sport: 'hurling',  level: 'club', grade: 'senior' },
    { url: 'https://offaly.gaa.ie/fixtures-results/hurling/club/intermediate/',  sport: 'hurling',  level: 'club', grade: 'intermediate' },
    { url: 'https://offaly.gaa.ie/fixtures-results/hurling/club/junior/',         sport: 'hurling',  level: 'club', grade: 'junior' },
  ]);
}

function fetchTipperaryHurlingCompetitions() {
  return fetchCacCountyCompetitions('tipperary.gaa.ie', [
    { url: 'https://tipperary.gaa.ie/fixtures-results/hurling/club/senior/',       sport: 'hurling', level: 'club', grade: 'senior' },
    { url: 'https://tipperary.gaa.ie/fixtures-results/hurling/club/intermediate/', sport: 'hurling', level: 'club', grade: 'intermediate' },
    { url: 'https://tipperary.gaa.ie/fixtures-results/hurling/club/junior/',        sport: 'hurling', level: 'club', grade: 'junior' },
  ]);
}



// Discover all Kerry competitions (football + hurling) from listing pages.
// Kerry URLs use sponsor prefixes — strip known ones for cleaner display names.
function kerryCompNameFromPath(path, grade) {
  const slug = path.split('/').filter(Boolean).slice(-2, -1)[0] || '';
  const cleaned = slug
    .replace(/^kerry-petroleum-/, '')
    .replace(/^garveys-supervalu-/, '')
    .replace(/^mccarthy-insurance-group-/, '')
    .replace(/^20\d\d-/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
  return cleaned || `${grade.charAt(0).toUpperCase() + grade.slice(1)} Championship`;
}

function fetchKerryCompetitions() {
  return fetchCacCountyCompetitions('www.kerrygaa.ie', [
    { url: 'https://www.kerrygaa.ie/fixtures-results/football/club/senior/',       sport: 'football', level: 'club', grade: 'senior' },
    { url: 'https://www.kerrygaa.ie/fixtures-results/football/club/intermediate/', sport: 'football', level: 'club', grade: 'intermediate' },
    { url: 'https://www.kerrygaa.ie/fixtures-results/football/club/junior/',        sport: 'football', level: 'club', grade: 'junior' },
    { url: 'https://www.kerrygaa.ie/fixtures-results/hurling/club/senior/',        sport: 'hurling',  level: 'club', grade: 'senior' },
    { url: 'https://www.kerrygaa.ie/fixtures-results/hurling/club/intermediate/',  sport: 'hurling',  level: 'club', grade: 'intermediate' },
    { url: 'https://www.kerrygaa.ie/fixtures-results/hurling/club/junior/',         sport: 'hurling',  level: 'club', grade: 'junior' },
  ], kerryCompNameFromPath);
}

// Kerry Minor Football Championship (from kerrygaa.ie, Sep 2026)
const KERRY_STATIC_FIXTURES = [
  mkStatic('Kerry','East Kerry','Dr. Crokes','10 September 2026','18:00','Fitzgerald Stadium, Killarney','Minor Football Championship','SF'),
  mkStatic('Kerry','St Brendans Board','North Kerry','10 September 2026','19:00','Austin Stack Park, Tralee','Minor Football Championship','SF'),
  mkStatic('Kerry','South Kerry','Kenmare District','17 September 2026','18:15','Fossa','Minor Football Championship Shield','Final'),
  mkStatic('Kerry','East Kerry','North Kerry','17 September 2026','19:30','Austin Stack Park, Tralee','Minor Football Championship','Final'),
];

const CORK_NAME_FIX = {
  'ODonovan Rossa': 'O Donovan Rossa',
  'BéalÁtha\'n Ghaorthaidh': 'Béal Átha\'n Ghaorthaidh',
};
function fixCorkName(s) { return CORK_NAME_FIX[s] || s; }

const KERRY_NAME_FIX = {
  'KillarneyLegion': 'Killarney Legion',
  'StMary\'s': 'St Mary\'s',
  'StBrendan\'s': 'St Brendan\'s',
  'StPatsBlennerville': 'St Pats Blennerville',
  'ValentiaYoungIslanders': 'Valentia Young Islanders',
  'SkelligRangers': 'Skellig Rangers',
  'LauneRangers': 'Laune Rangers',
  'JohnMitchels': 'John Mitchels',
  'ListowelEmmets': 'Listowel Emmets',
  'KerinsO`Rahilly\'s': 'Kerins O\'Rahilly\'s',
  'CastlegregoryGAAClub': 'Castlegregory GAA Club',
  'PiarsaighNaDromoda': 'Piarsaigh Na Dromoda',
  'AnGhaeltacht': 'An Ghaeltacht',
  'JPOSullivan Park(Laune Rangers)': "JP O'Sullivan Park (Laune Rangers)",
  'JPO Sullivan Park(Laune Rangers)': "JP O'Sullivan Park (Laune Rangers)",
};
function fixKerryName(s) { return KERRY_NAME_FIX[s] || s; }


// Offaly U20 Hurling Championship Semi-Final Replay (from offaly.gaa.ie, Sep 2026)
const OFFALY_STATIC_FIXTURES = [
  mkStatic('Offaly','St Rynaghs','SBK','10 September 2026','19:30','Coolderry','U20 Hurling Championship','SF'),
];


// ---- Roscommon: custom WordPress site (gaaroscommon.ie) ----
// Fixtures are server-rendered in a #foireannFixures div. Current HTML structure:
//   <h3 class="results-date">Friday 31st Jul 2026</h3>
//   <div class="competition-title"><a href="...">Sponsor Name Competition - Round N</a></div>
//   <div class="gaa-match-time"><div class="time">6:30 PM</div></div>
//   <div class="gaa-team gaa-team-home"><div class="team-logo">...</div><strong>HOME</strong></div>
//   <div class="gaa-team gaa-team-away"><div class="team-logo">...</div><strong>AWAY</strong></div>
//   <div class="gaa-match-meta"><div><strong>Venue:</strong><br>VenueName</div></div>
// Token groups: [1]=date [2]=comp title [3]=time [4]=home [5]=away [6]=venue

function roscommonTo24h(timeStr) {
  const m = timeStr.trim().match(/(\d+):(\d{2})\s*(AM|PM)/i);
  if (!m) return timeStr;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

const ROSCOMMON_TOKEN_RE =
  /class="results-date">([^<]+)<\/h3>|class="competition-title">\s*<a[^>]*>([^<]+)<\/a>|class="time">([^<]+)<\/div>|class="gaa-team gaa-team-home">\s*<div[^>]*>[\s\S]*?<\/div>\s*<strong>([^<]+)<\/strong>|class="gaa-team gaa-team-away">\s*<div[^>]*>[\s\S]*?<\/div>\s*<strong>([^<]+)<\/strong>|<strong>Venue:<\/strong><br>\s*([^\r\n<]+)/g;

function roscommonParsePanel(panelHtml, compNameFn, sport) {
  const out = [];
  let curDate = null;
  let curComp = null;
  let curRound = null;
  let buf = emptyBuf();
  const re = new RegExp(ROSCOMMON_TOKEN_RE);
  let m;
  while ((m = re.exec(panelHtml))) {
    if (m[1] !== undefined) {
      curDate = m[1].trim();
      buf = emptyBuf();
    } else if (m[2] !== undefined) {
      const raw = decodeEntities(m[2].trim());
      const dashIdx = raw.lastIndexOf(' - ');
      curRound = dashIdx !== -1 ? raw.slice(dashIdx + 3).trim() : '';
      curComp = compNameFn ? compNameFn(raw) : (dashIdx !== -1 ? raw.slice(0, dashIdx).trim() : raw);
      buf = emptyBuf();
    } else if (m[3] !== undefined) {
      buf = emptyBuf();
      buf.time = roscommonTo24h(m[3].trim());
    } else if (m[4] !== undefined) {
      buf.home = decodeEntities(m[4].trim());
    } else if (m[5] !== undefined) {
      buf.away = decodeEntities(m[5].trim());
    } else if (m[6] !== undefined) {
      buf.venue = decodeEntities(m[6].trim()).trim();
      if (buf.home && buf.away && curDate && curComp) {
        out.push({
          county: 'Roscommon',
          teamA: buf.home,
          teamB: buf.away,
          date: laoisDateToFull(curDate),
          time: buf.time || '',
          venue: buf.venue,
          competition: curComp,
          round: curRound || '',
          sport,
        });
      }
      buf = emptyBuf();
    }
  }
  return out;
}

async function fetchRoscommonSport(sport) {
  const url = `https://www.gaaroscommon.ie/matches/${sport}/senior/`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`Roscommon ${sport} fetch failed: ${res.status}`);
  const html = await res.text();
  const startIdx = html.indexOf('id="foireannFixures"');
  const endIdx = html.indexOf('id="foireannResults"');
  const panelHtml = (startIdx !== -1 && endIdx !== -1)
    ? html.slice(startIdx, endIdx)
    : (startIdx !== -1 ? html.slice(startIdx) : html);
  return roscommonParsePanel(panelHtml, null, sport === 'football' ? 'Football' : 'Hurling');
}

// Maps website competition title (sponsor-prefixed) to the user-facing short name.
// Returns null only for underage/minor competitions which should be skipped.
function roscommonFootballCompName(raw) {
  if (/Junior A Football Championship/i.test(raw)) return 'Junior A Football Championship';
  if (/Intermediate Football Championship/i.test(raw)) return 'Intermediate Football Championship';
  if (/Senior Football Championship/i.test(raw)) return 'Senior Football Championship';
  // Skip underage/minor only
  if (/\b(minor|under.?\d+|u\d+|u-\d+|feile|bainne|primary)\b/i.test(raw)) return null;
  // Strip leading sponsor prefix (first ' - ' segment if present) and trailing round suffix
  const parts = raw.split(' - ');
  // Heuristic: if first part looks like a sponsor (no 'championship'/'league'/'cup'), drop it
  const start = parts.length > 1 && !/championship|league|cup/i.test(parts[0]) ? 1 : 0;
  // Drop trailing round segment (Round N / Rd N)
  const end = parts.length > 1 && /^(?:Round|Rd\.?)\s*\d+$/i.test(parts[parts.length - 1])
    ? parts.length - 1 : parts.length;
  return parts.slice(start, end).join(' - ').trim() || raw.trim();
}

// Static fixture data from the 2026 Roscommon GAA Championship Fixtures spreadsheet.
// Used as fallback when a fixture is not yet on the website; website data takes priority.
const ROSCOMMON_FOOTBALL_STATIC = [
  // Senior Football Championship
  mkStatic('Roscommon','Oran (Football)','Elphin','31 July 2026','19:30','Rockfield,Oran','Senior Football Championship','Round 1'),
  mkStatic('Roscommon','St Brigids','Michael Glaveys','31 July 2026','20:00',"St Brigid's GAA, Kiltoom",'Senior Football Championship','Round 1'),
  mkStatic('Roscommon','Pádraig Pearses GAA','Roscommon Gaels','31 July 2026','20:00','Woodmount','Senior Football Championship','Round 1'),
  mkStatic('Roscommon','Boyle','Clann na nGael','1 August 2026','17:00','Abbey Park','Senior Football Championship','Round 1'),
  mkStatic('Roscommon','Western Gaels','Strokestown','1 August 2026','19:30','Nash Park','Senior Football Championship','Round 1'),
  mkStatic('Roscommon','St. Faithleach\'s','Castlerea St Kevins','2 August 2026','15:00','Ballyleague','Senior Football Championship','Round 1'),
  mkStatic('Roscommon','Pádraig Pearses GAA','Boyle','14 August 2026','20:00','Strokestown','Senior Football Championship','Round 2'),
  mkStatic('Roscommon','Western Gaels','St Brigids','15 August 2026','18:00','Tulsk','Senior Football Championship','Round 2'),
  mkStatic('Roscommon','Elphin','Castlerea St Kevins','15 August 2026','18:00','Rockfield,Oran','Senior Football Championship','Round 2'),
  mkStatic('Roscommon','Strokestown','Michael Glaveys','16 August 2026','15:00','Enfield','Senior Football Championship','Round 2'),
  mkStatic('Roscommon','St. Faithleach\'s','Oran (Football)','16 August 2026','15:00','Kilbride','Senior Football Championship','Round 2'),
  mkStatic('Roscommon','Clann na nGael','Roscommon Gaels','16 August 2026','16:00',"St Brigid's GAA, Kiltoom",'Senior Football Championship','Round 2'),
  mkStatic('Roscommon','Clann na nGael','Pádraig Pearses GAA','28 August 2026','20:00','Johnstown','Senior Football Championship','Round 3'),
  mkStatic('Roscommon','Roscommon Gaels','Boyle','28 August 2026','20:00','Roscommon Gaels Club, Lisnamult, Roscommon','Senior Football Championship','Round 3'),
  mkStatic('Roscommon','Castlerea St Kevins','Oran (Football)','29 August 2026','18:00',"O'Rourke Park",'Senior Football Championship','Round 3'),
  mkStatic('Roscommon','Elphin','St. Faithleach\'s','29 August 2026','18:00','Orchard Park','Senior Football Championship','Round 3'),
  mkStatic('Roscommon','Strokestown','St Brigids','30 August 2026','16:00','Strokestown','Senior Football Championship','Round 3'),
  mkStatic('Roscommon','Michael Glaveys','Western Gaels','30 August 2026','16:00','Ballinlough','Senior Football Championship','Round 3'),
  // Intermediate Football Championship
  mkStatic('Roscommon','Tulsk Lord Edwards','St. Dominic\'s G.A.A. Club','31 July 2026','19:30','Tulsk','Intermediate Football Championship','Round 1'),
  mkStatic('Roscommon','Fuerty','Éire Óg','31 July 2026','19:30','Mulhern Park, Fuerty','Intermediate Football Championship','Round 1'),
  mkStatic('Roscommon','St Brigids','Naomh Bearrai','1 August 2026','17:00',"St Brigid's GAA, Kiltoom",'Intermediate Football Championship','Round 1'),
  mkStatic('Roscommon','Pádraig Pearses GAA','St Michael\'s','1 August 2026','17:00','Woodmount','Intermediate Football Championship','Round 1'),
  mkStatic('Roscommon','Shannon Gaels','Creggs','1 August 2026','18:00','Tom Collins Park Croghan','Intermediate Football Championship','Round 1'),
  mkStatic('Roscommon','Kilmore','St. Croans','2 August 2026','17:00','Tom Collins Park Croghan','Intermediate Football Championship','Round 1'),
  mkStatic('Roscommon','Naomh Bearrai','Tulsk Lord Edwards','14 August 2026','20:00','Tarmonbarry','Intermediate Football Championship','Round 2'),
  mkStatic('Roscommon','Éire Óg','St. Croans','14 August 2026','19:15','Ballinlough','Intermediate Football Championship','Round 2'),
  mkStatic('Roscommon','Shannon Gaels','Pádraig Pearses GAA','15 August 2026','17:00','Lisnamult','Intermediate Football Championship','Round 2'),
  mkStatic('Roscommon','Kilmore','Fuerty','15 August 2026','17:00','Strokestown','Intermediate Football Championship','Round 2'),
  mkStatic('Roscommon','Creggs','St Michael\'s','16 August 2026','12:00','Enfield','Intermediate Football Championship','Round 2'),
  mkStatic('Roscommon','St. Dominic\'s G.A.A. Club','St Brigids','16 August 2026','13:00','Knockcroghery','Intermediate Football Championship','Round 2'),
  mkStatic('Roscommon','Naomh Bearrai','St. Dominic\'s G.A.A. Club','28 August 2026','20:00','Strokestown','Intermediate Football Championship','Round 3'),
  mkStatic('Roscommon','St Brigids','Tulsk Lord Edwards','28 August 2026','20:00','Ballyforan','Intermediate Football Championship','Round 3'),
  mkStatic('Roscommon','Creggs','Pádraig Pearses GAA','29 August 2026','17:00','Creggs GAA Pitch','Intermediate Football Championship','Round 3'),
  mkStatic('Roscommon','St Michael\'s','Shannon Gaels','29 August 2026','17:00','Ardcarne Park','Intermediate Football Championship','Round 3'),
  mkStatic('Roscommon','Éire Óg','Kilmore','30 August 2026','14:00',"O'Rourke Park",'Intermediate Football Championship','Round 3'),
  mkStatic('Roscommon','St. Croans','Fuerty','30 August 2026','14:00','Enfield','Intermediate Football Championship','Round 3'),
  // Junior A Football Championship
  mkStatic('Roscommon','St Joseph\'s GAA Club (Kilteevan)','St Ronan\'s GAA Club','1 August 2026','17:00','Kilteevan','Junior A Football Championship','Round 1'),
  mkStatic('Roscommon','St. Dominic\'s G.A.A. Club','St Aidan\'s','2 August 2026','13:00','Knockcroghery','Junior A Football Championship','Round 1'),
  mkStatic('Roscommon','Ballinameen','Boyle','2 August 2026','13:00','Davonna Park Ballinameen','Junior A Football Championship','Round 1'),
  mkStatic('Roscommon','Clann na nGael','St Brigids','2 August 2026','13:00','Johnstown','Junior A Football Championship','Round 1'),
  mkStatic('Roscommon','Kilbride','Roscommon Gaels','2 August 2026','13:00','Kilbride','Junior A Football Championship','Round 1'),
  mkStatic('Roscommon','Western Gaels','Kilglass Gaels','2 August 2026','15:00','Nash Park','Junior A Football Championship','Round 1'),
  mkStatic('Roscommon','St Brigids','Roscommon Gaels','14 August 2026','19:15','Knockcroghery','Junior A Football Championship','Round 2'),
  mkStatic('Roscommon','Clann na nGael','Kilbride','14 August 2026','20:00','Ballyforan','Junior A Football Championship','Round 2'),
  mkStatic('Roscommon','St. Dominic\'s G.A.A. Club','Ballinameen','15 August 2026','17:00','Kilbride','Junior A Football Championship','Round 2'),
  mkStatic('Roscommon','St Ronan\'s GAA Club','Kilglass Gaels','16 August 2026','13:00','Tom Collins Park Croghan','Junior A Football Championship','Round 2'),
  mkStatic('Roscommon','St Joseph\'s GAA Club (Kilteevan)','Western Gaels','16 August 2026','13:00','Orchard Park','Junior A Football Championship','Round 2'),
  mkStatic('Roscommon','St Aidan\'s','Boyle','16 August 2026','15:00',"O'Rourke Park",'Junior A Football Championship','Round 2'),
  mkStatic('Roscommon','Kilglass Gaels','St Joseph\'s GAA Club (Kilteevan)','29 August 2026','16:30','Kilglass Gaels GAA Grounds','Junior A Football Championship','Round 3'),
  mkStatic('Roscommon','St Ronan\'s GAA Club','Western Gaels','29 August 2026','16:30','Kilronan Park','Junior A Football Championship','Round 3'),
  mkStatic('Roscommon','Roscommon Gaels','Clann na nGael','29 August 2026','19:00','Lisnamult','Junior A Football Championship','Round 3'),
  mkStatic('Roscommon','St Brigids','Kilbride','29 August 2026','19:00',"St Brigid's GAA, Kiltoom",'Junior A Football Championship','Round 3'),
  mkStatic('Roscommon','St Aidan\'s','Ballinameen','30 August 2026','13:00','Ballyforan','Junior A Football Championship','Round 3'),
  mkStatic('Roscommon','Boyle','St. Dominic\'s G.A.A. Club','30 August 2026','13:00','Abbey Park','Junior A Football Championship','Round 3'),
  // Minor Football Championship Finals (from gaaroscommon.ie, Sep 2026)
  mkStatic('Roscommon','Pádraig Pearses GAA','Roscommon Gaels','11 September 2026','18:30','Ballyforan','Minor A Football Championship','Final'),
  mkStatic('Roscommon','St Brigids','Boyle','13 September 2026','15:00','Enfield','Minor B Football Championship','Final'),
];

async function fetchKildare(cacDebug) {
  const out = [];
  const seen = new Set();
  const competitions = [
    { sport: 'football', grade: 'senior',       name: 'Kildare Senior Football Championship' },
    { sport: 'football', grade: 'intermediate', name: 'Kildare Intermediate Football Championship' },
    { sport: 'football', grade: 'junior',       name: 'Kildare Junior Football Championship' },
    { sport: 'hurling',  grade: 'senior',       name: 'Kildare Senior Hurling Championship' },
    { sport: 'hurling',  grade: 'intermediate', name: 'Kildare Intermediate Hurling Championship' },
    { sport: 'hurling',  grade: 'junior',       name: 'Kildare Junior Hurling Championship' },
  ];
  for (const { sport, grade, name } of competitions) {
    const baseUrl = `https://kildaregaa.ie/fixtures-results/${sport}/club/${grade}/`;
    let page = 0, hasMore = true;
    while (hasMore && page < 4) {
      const url = `${baseUrl}?ajax=1&feed_type=fixtures&page=${page}&size=100&sport=${sport}&level=club&grade=${grade}`;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json', Referer: baseUrl },
        });
        if (!res.ok) {
          cacDebug.push({ county: 'Kildare', sport, grade, page, stage: 'http-error', status: res.status });
          break;
        }
        const bodyText = await res.text();
        const json = JSON.parse(stripBom(bodyText));
        if (!json.ok) {
          cacDebug.push({ county: 'Kildare', sport, grade, page, stage: 'json-not-ok' });
          break;
        }
        const before = out.length;
        parseCacHtmlDirect(json.html, out, 'Kildare', name);
        cacDebug.push({ county: 'Kildare', sport, grade, page, stage: 'ok', newRows: out.length - before, hasMore: json.hasMore });
        hasMore = !!json.hasMore;
        page++;
      } catch (err) {
        cacDebug.push({ county: 'Kildare', sport, grade, page, stage: 'fetch-threw', error: String(err) });
        break;
      }
    }
  }
  const deduped = [];
  for (const f of out) {
    if (f._rawComp && f._rawComp.includes('Reserve')) continue;
    const key = `${f.competition}|${f.teamA}|${f.teamB}|${f.date}|${f.time}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(f); }
  }
  return deduped;
}

async function fetchTipperaryFootball(cacDebug) {
  const out = [];
  const seen = new Set();
  const grades = [
    { grade: 'senior',       name: 'Tipperary Senior Football Championship' },
    { grade: 'intermediate', name: 'Tipperary Intermediate Football Championship' },
  ];
  for (const { grade, name } of grades) {
    const baseUrl = `https://tipperary.gaa.ie/fixtures-results/football/club/${grade}/`;
    let page = 0, hasMore = true;
    while (hasMore && page < 4) {
      const url = `${baseUrl}?ajax=1&feed_type=fixtures&page=${page}&size=100&sport=football&level=club&grade=${grade}`;
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': UA, Accept: 'application/json', Referer: baseUrl },
        });
        if (!res.ok) {
          cacDebug.push({ county: 'Tipperary', grade, page, stage: 'http-error', status: res.status });
          break;
        }
        const bodyText = await res.text();
        const json = JSON.parse(stripBom(bodyText));
        if (!json.ok) {
          cacDebug.push({ county: 'Tipperary', grade, page, stage: 'json-not-ok' });
          break;
        }
        const before = out.length;
        parseCacHtmlDirect(json.html, out, 'Tipperary', name);
        cacDebug.push({ county: 'Tipperary', grade, page, stage: 'ok', newRows: out.length - before, hasMore: json.hasMore });
        hasMore = !!json.hasMore;
        page++;
      } catch (err) {
        cacDebug.push({ county: 'Tipperary', grade, page, stage: 'fetch-threw', error: String(err) });
        break;
      }
    }
  }
  const deduped = [];
  for (const f of out) {
    const key = `${f.competition}|${f.teamA}|${f.teamB}|${f.date}|${f.time}`;
    if (!seen.has(key)) { seen.add(key); deduped.push(f); }
  }
  return deduped;
}

async function fetchRoscommonFootball() {
  let webFixtures = [];
  try {
    const res = await fetch('https://www.gaaroscommon.ie/matches/football/', { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const html = await res.text();
      const startIdx = html.indexOf('id="foireannFixures"');
      const endIdx = html.indexOf('id="foireannResults"');
      const panelHtml = (startIdx !== -1 && endIdx !== -1)
        ? html.slice(startIdx, endIdx)
        : (startIdx !== -1 ? html.slice(startIdx) : html);
      webFixtures = roscommonParsePanel(panelHtml, roscommonFootballCompName, 'Football')
        .filter(f => f.competition !== null);
    }
  } catch (_) { /* static fallback */ }

  const webKeys = new Set(webFixtures.map(f => `${f.teamA}|${f.teamB}|${f.date}`));
  const out = [...webFixtures];
  for (const s of ROSCOMMON_FOOTBALL_STATIC) {
    if (!webKeys.has(`${s.teamA}|${s.teamB}|${s.date}`)) out.push(s);
  }
  return out;
}

// ---- Longford: Foireann Open Data API ----
// longfordgaa.ie uses a Foireann-powered JavaScript widget — the fixture data
// is not in the HTML. The Foireann Open Data API (api.foireann.ie) is the
// canonical source, but requires a Bearer API key restricted to Longford's
// unit. Set FOIREANN_API_KEY as a Cloudflare Worker environment variable.
// Apply for a key at: https://gmssupport.zendesk.com/hc/en-gb/articles/14473705878812
//
// User's filter:
//   Senior Football  – all Club Senior Football fixtures
//   Intermediate     – only "Longford Championship" fixtures (Group A & B)

const FOIREANN_BASE = 'https://api.foireann.ie/open-data/v1/fixtures';
const FOIREANN_MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

function foireannDateToFull(isoStr) {
  // "2026-08-15T19:30:00" or "2026-08-15T19:30:00Z"
  const d = new Date(isoStr);
  const day = d.getUTCDate();
  const month = FOIREANN_MONTHS[d.getUTCMonth()];
  const year = d.getUTCFullYear();
  return `${day} ${month} ${year}`;
}

function foireannTime(isoStr) {
  const d = new Date(isoStr);
  return `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
}

async function fetchFoireannPage(apiKey, activity, grade, page) {
  const url = `${FOIREANN_BASE}?competition.activity=${activity}&competition.grade=${grade}&isResult=false&page=${page}&size=100`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json',
      'User-Agent': UA,
    },
  });
  if (!res.ok) throw new Error(`Foireann ${activity}/${grade} p${page} => ${res.status}`);
  return res.json();
}

async function fetchLongfordGrade(apiKey, activity, grade, compFilter) {
  const out = [];
  let page = 0;
  while (page < 5) {
    const data = await fetchFoireannPage(apiKey, activity, grade, page);
    const items = data.content || [];
    for (const fix of items) {
      const compName = (fix.competition && fix.competition.name) ? fix.competition.name : '';
      if (compFilter && !compFilter(compName)) continue;
      if (!fix.homeTeam || !fix.awayTeam || !fix.startDate) continue;
      out.push({
        county: 'Longford',
        teamA: fix.homeTeam.name || '',
        teamB: fix.awayTeam.name || '',
        date: foireannDateToFull(fix.startDate),
        time: foireannTime(fix.startDate),
        venue: (fix.place && fix.place.name) ? fix.place.name : '',
        competition: compName,
        round: (fix.round && fix.round.name) ? fix.round.name : '',
        sport: activity === 'hurling' ? 'Hurling' : 'Football',
      });
    }
    if (page + 1 >= (data.totalPages || 1)) break;
    page++;
  }
  return out;
}

async function fetchLongford(apiKey) {
  if (!apiKey) return [];
  const [sfcSenior, sfcIntermediate, shcSenior, shcIntermediate] = await Promise.all([
    fetchLongfordGrade(apiKey, 'football', 'senior', null),
    fetchLongfordGrade(apiKey, 'football', 'intermediate', (name) =>
      /longford\s+championship|intermediate\s+football\s+championship/i.test(name)),
    fetchLongfordGrade(apiKey, 'hurling', 'senior', null),
    fetchLongfordGrade(apiKey, 'hurling', 'intermediate', (name) =>
      /longford\s+championship|intermediate\s+hurling\s+championship/i.test(name)),
  ]);
  return [...sfcSenior, ...sfcIntermediate, ...shcSenior, ...shcIntermediate];
}

// ---- Longford: static data ----
// From LONGFORD 2026 Fixtures.docx. Covers SFC (Groups A & B, Rds 1-5),
// IFC (Groups A & B, Rds 1-3), and Senior Hurling Championship (Rds 1-3).
// Longford only has 3 hurling clubs so there is no Intermediate Hurling Championship.
// Foireann API fetch (fetchLongford) is kept for when FOIREANN_API_KEY is available.
const LONGFORD_FIXTURES = [];
[
  ['Longford Slashers','Clonguish Gaels','11 July 2026','19:00','C & D Devine Park','Round 1'],
  ['Longford Slashers','Wolfe Tones','31 July 2026','20:00','Allen Park','Round 2'],
  ['Clonguish Gaels','Wolfe Tones','22 August 2026','20:00','','Round 3'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Senior Hurling Championship',r[5])));

[
  ['Mullinalaghta St. Columba\'s','Killoe Young Emmets','16 July 2026','20:00','Glennon Brothers Pearse Park','Round 1'],
  ['Rathcline','Abbeylara','17 July 2026','20:00','Glennon Brothers Pearse Park','Round 1'],
  ['Ardagh Moydow','Dromard','18 July 2026','19:00','Monaduff','Round 1'],
  ['Abbeylara','Ardagh Moydow','24 July 2026','20:00','C & D Devine Park','Round 2'],
  ['Dromard','Mullinalaghta St. Columba\'s','25 July 2026','19:00','Fr. McGee Park','Round 2'],
  ['Killoe Young Emmets','Rathcline','25 July 2026','19:00','Leo Casey Park','Round 2'],
  ['Killoe Young Emmets','Abbeylara','7 August 2026','20:00','Fr. McGee Park','Round 3'],
  ['Mullinalaghta St. Columba\'s','Ardagh Moydow','8 August 2026','19:00','Higginstown','Round 3'],
  ['Dromard','Rathcline','9 August 2026','14:00','Oliver Lynch Park','Round 3'],
  ['Ardagh Moydow','Killoe Young Emmets','14 August 2026','20:00','Allen Park','Round 4'],
  ['Abbeylara','Dromard','15 August 2026','19:00','Emmet Park','Round 4'],
  ['Rathcline','Mullinalaghta St. Columba\'s','15 August 2026','19:00','Michael Moran Park','Round 4'],
  ['Mullinalaghta St. Columba\'s','Abbeylara','29 August 2026','19:00','Higginstown','Round 5'],
  ['Ardagh Moydow','Rathcline','29 August 2026','19:00','Michael Fay Park','Round 5'],
  ['Dromard','Killoe Young Emmets','29 August 2026','19:00','Monaduff','Round 5'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group A',r[5])));

[
  ['St. Mary\'s Granard','Colmcille','17 July 2026','20:00','Maguire Park','Round 1'],
  ['Carrickedmond','Longford Slashers','18 July 2026','19:00','Dunbeggan','Round 1'],
  ['Clonguish','St. Mary\'s Granard','23 July 2026','20:00','Glennon Brothers Pearse Park','Round 2'],
  ['Colmcille','Carrickedmond','24 July 2026','20:00','Emmet Park','Round 2'],
  ['Carrickedmond','Clonguish','7 August 2026','20:00','McGann Park','Round 3'],
  ['Longford Slashers','Colmcille','9 August 2026','18:00','Allen Park','Round 3'],
  ['Clonguish','Longford Slashers','15 August 2026','19:00','Monaduff','Round 4'],
  ['St. Mary\'s Granard','Carrickedmond','16 August 2026','18:00','Páirc na nGael','Round 4'],
  ['Longford Slashers','St. Mary\'s Granard','30 August 2026','14:30','Keenan Park','Round 5'],
  ['Colmcille','Clonguish','30 August 2026','14:30','Oliver Lynch Park','Round 5'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group B',r[5])));

[
  ['Grattan Óg','Killoe Young Emmets','8 August 2026','19:00','Michael Fay Park','Round 1'],
  ['Ballymahon','St. Brigid\'s Killashee','8 August 2026','19:00','Páirc Chiaráin','Round 1'],
  ['St. Brigid\'s Killashee','Grattan Óg','14 August 2026','20:00','McGann Park','Round 2'],
  ['Killoe Young Emmets','Ballymahon','16 August 2026','14:00','Dunbeggan','Round 2'],
  ['Killoe Young Emmets','St. Brigid\'s Killashee','28 August 2026','','C & D Devine Park','Round 3'],
  ['Ballymahon','Grattan Óg','28 August 2026','','Flood Park','Round 3'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group A',r[5])));

[
  ['Cashel','Fr. Manning Gaels','9 August 2026','16:00','Killashee','Round 1'],
  ['Mostrim','Seán Connolly\'s','9 August 2026','16:00','Keenan Park','Round 1'],
  ['Fr. Manning Gaels','Mostrim','16 August 2026','16:00','Páirc na nGael','Round 2'],
  ['Seán Connolly\'s','Cashel','16 August 2026','16:00','Clonbonny','Round 2'],
  ['Seán Connolly\'s','Fr. Manning Gaels','28 August 2026','','Ballybrien','Round 3'],
  ['Cashel','Mostrim','28 August 2026','','Leo Casey Park','Round 3'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group B',r[5])));

// Longford - Senior Football Championship KO Quarter Finals (source: longfordgaa.ie Sep 2026)
[
  ['St. Mary\'s Granard','Killoe Young Emmets','12 September 2026','16:00','','QF'],
  ['Abbeylara','Longford Slashers','12 September 2026','18:00','','QF'],
  ['Dromard','Colmcille','13 September 2026','14:15','','QF'],
  ['Clonguish','Ardagh Moydow GAA','13 September 2026','16:15','','QF'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship',r[5])));

// Longford - Senior Football Championship Relegation (source: longfordgaa.ie Sep 2026)
[
  ['Mullinalaghta St. Columba\'s','Rathcline','11 September 2026','20:00','','Round 1'],
  ['Carrickedmond','Mullinalaghta St. Columba\'s','18 September 2026','20:00','','Round 3'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Relegation',r[5])));

// Longford - Intermediate Football Championship Relegation (source: longfordgaa.ie Sep 2026)
[
  ['Fr Manning Gaels','Cashel','11 September 2026','20:00','','Round 1'],
  ['Killoe Young Emmets','St. Brigid\'s Killashee','11 September 2026','20:00','','Round 1'],
  ['St. Brigid\'s Killashee','Fr Manning Gaels','18 September 2026','20:00','','Round 2'],
  ['Cashel','Killoe Young Emmets','18 September 2026','20:00','','Round 2'],
  ['Killoe Young Emmets','Fr Manning Gaels','25 September 2026','20:00','','Round 3'],
  ['Cashel','St. Brigid\'s Killashee','25 September 2026','20:00','','Round 3'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Relegation',r[5])));

// Longford - Junior A Football Championship Round 5 (source: longfordgaa.ie Sep 2026)
[
  ['Kenagh G.A.A','Clonguish','13 September 2026','12:00','','Round 5'],
  ['Legan Sarsfields','Longford Slashers','13 September 2026','18:00','','Round 5'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Junior A Football Championship',r[5])));

// Longford - Junior C Football Championship KO Semi Finals (source: longfordgaa.ie Sep 2026)
[
  ['Ardagh Moydow GAA','Fr Manning Gaels','12 September 2026','20:15','','SF'],
  ['Mostrim','Cashel','13 September 2026','12:00','','SF'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Junior C Football Championship',r[5])));

// Longford - Intermediate Football Championship KO Semi Finals (source: longfordgaa.ie Sep 2026)
[
  ['Grattan Óg','Mostrim','18 September 2026','','','Semi Final'],
  ['Seán Connollys','Ballymahon','19 September 2026','','','Semi Final'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship',r[5])));

// Longford - Senior Football Championship KO Semi Finals (source: longfordgaa.ie Sep 2026)
[
  ['Abbeylara','Killoe Young Emmets','26 September 2026','12:00','','Semi Final'],
  ['Clonguish','Dromard','27 September 2026','12:00','','Semi Final'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship',r[5])));

// Longford - Leinster Club Championships (source: longfordgaa.ie Sep 2026)
[
  ['Longford','Kildare','31 October 2026','','','Round 1'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Leinster Club Intermediate Football Championship',r[5])));
[
  ['Meath','Longford','31 October 2026','','','Round 1'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Leinster Club Junior Football Championship',r[5])));
[
  ['Westmeath','Longford','1 November 2026','14:00','','Round 1'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Leinster Club Senior Football Championship',r[5])));
[
  ['Longford Slashers','Europe','7 November 2026','','','Semi Final'],
].forEach(r=>LONGFORD_FIXTURES.push(mkStatic('Longford',r[0],r[1],r[2],r[3],r[4],'Leinster Club Special Hurling Championship',r[5])));

// ---- Kildare: static data ----
// Kildare's fixtures aren't published on a scrapable website; they were
// manually transcribed from official Cill Dara CCC fixture-sheet images
// (sourced from SharePoint) and cross-checked between each competition's
// "group view" and "round view" sheets for consistency.
function mkStatic(county, teamA, teamB, date, time, venue, competition, round) {
  return { county, teamA, teamB, date, time, venue, competition, round };
}

const TIPPERARY_FIXTURES = [];

// Tipperary - Intermediate Hurling Championship Round 2
// Groups 2-4 not yet on tipperary.gaa.ie; Groups 1+ (Senior, Prm Int, Int Grp 1) served by CAC feed.
[
  ['Arravale Rovers','Shannon Rovers','9 August 2026','18:30','Newport','Round 2'],
  ['Carrick Davins','Clonakenny','9 August 2026','17:00','Cashel','Round 2'],
].forEach(r=>TIPPERARY_FIXTURES.push(mkStatic('Tipperary',r[0],r[1],r[2],r[3],r[4],'Intermediate Hurling Championship Group 2',r[5])));

[
  ['Ballingarry','Cappawhite','7 August 2026','19:15','New Inn','Round 2'],
  ['Holycross Ballycahill','Skeheenarinky','9 August 2026','14:30','Golden','Round 2'],
].forEach(r=>TIPPERARY_FIXTURES.push(mkStatic('Tipperary',r[0],r[1],r[2],r[3],r[4],'Intermediate Hurling Championship Group 3',r[5])));

[
  ['Borrisokane','Newport','9 August 2026','14:15','Nenagh','Round 2'],
  ['Ballybacon Grange','Moyle Rovers','8 August 2026','18:00','Cahir','Round 2'],
].forEach(r=>TIPPERARY_FIXTURES.push(mkStatic('Tipperary',r[0],r[1],r[2],r[3],r[4],'Intermediate Hurling Championship Group 4',r[5])));

// Tipperary Minor Football Championship Finals (from tipperary.gaa.ie, Sep 2026)
[
  ['Cappawhite GAA','Cashel King Cormacs','8 September 2026','18:00','Pairc Ciocaim, Dundrum','Final'],
].forEach(r=>TIPPERARY_FIXTURES.push(mkStatic('Tipperary',r[0],r[1],r[2],r[3],r[4],'West Tipperary Minor A Football Championship',r[5])));

[
  ['Lattin Cullen Gaels','Golden-Kilfeacle','9 September 2026','18:00','Bansha','Final'],
].forEach(r=>TIPPERARY_FIXTURES.push(mkStatic('Tipperary',r[0],r[1],r[2],r[3],r[4],'West Tipperary Minor B Football Championship',r[5])));

[
  ['St Mary\'s','Mullinahone','10 September 2026','19:30','Fethard Town Park','Final'],
].forEach(r=>TIPPERARY_FIXTURES.push(mkStatic('Tipperary',r[0],r[1],r[2],r[3],r[4],'Minor A Hurling Championship',r[5])));

[
  ['Ballybacon Grange','Carrick Swan','10 September 2026','19:30','Fethard Town Park','Final'],
].forEach(r=>TIPPERARY_FIXTURES.push(mkStatic('Tipperary',r[0],r[1],r[2],r[3],r[4],'Minor B Hurling Championship',r[5])));

// Kildare fixtures are fetched live from kildaregaa.ie via fetchKildare().
const KILDARE_FIXTURES = [];

// ---- Carlow: live scraper ----
// Scrapes carlowgaa.ie/fixtures/ for the 4 target competitions.
// Falls back to empty array if the fetch fails.
async function fetchCarlowFixtures() {
  const TARGET_COMPS = [
    { pattern: /senior football championship/i,       name: 'Senior Football Championship' },
    { pattern: /intermediate football championship/i, name: 'Intermediate Football Championship' },
    { pattern: /senior hurling championship/i,        name: 'Senior Hurling Championship' },
    { pattern: /intermediate hurling championship/i,  name: 'Intermediate Hurling Championship' },
    { pattern: /junior hurling championship/i,        name: 'Junior Hurling Championship' },
    { pattern: /junior ['''']?a['''']? football championship/i, name: "Junior 'A' Football Championship" },
    { pattern: /junior ['''']?b['''']? (football )?championship/i, name: "Junior 'B' Football Championship" },
    { pattern: /junior ['''']?c['''']? (football )?championship/i, name: "Junior 'C' Football Championship" },
  ];
  try {
    const res = await fetch('https://carlowgaa.ie/fixtures/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      }
    });
    if (!res.ok) { console.error('fetchCarlowFixtures HTTP', res.status); return []; }
    const html = await res.text();
    // Strip tags and split into lines
    const text = html.replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&#[0-9]+;/g, '').replace(/&[a-z]+;/g, '');
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const fixtures = [];
    for (let i = 0; i < lines.length; i++) {
      const comp = TARGET_COMPS.find(c => c.pattern.test(lines[i]));
      if (!comp) continue;
      // Extract round from competition header "Sponsor Competition - Round - Year"
      const headerDash = lines[i].split(/\s*-\s*/);
      const round = headerDash.length >= 3 ? headerDash[headerDash.length - 2].trim() : '';
      // Next non-empty line should be "Team A vs Team B"
      const matchLine = lines[i + 1] || '';
      const vsMatch = matchLine.match(/^(.+?)\s+vs\s+(.+)$/i);
      if (!vsMatch) continue;
      // Skip "Referee" line, then find date/time/venue line
      let dateLine = '';
      for (let j = i + 2; j <= i + 4; j++) {
        if (/\d{2}-\d{2}-\d{4}/.test(lines[j] || '')) { dateLine = lines[j]; break; }
      }
      if (!dateLine) continue;
      // Parse: "DD-MM-YYYY / H:MM pm / Venue"
      const parts = dateLine.split('/').map(s => s.trim());
      if (parts.length < 3) continue;
      const [d, m, y] = parts[0].split('-');
      const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
      const date = `${parseInt(d,10)} ${MONTHS[parseInt(m,10)-1]} ${y}`;
      const timePart = parts[1]; // e.g. "7:00 pm"
      const venue = parts.slice(2).join('/').trim();
      fixtures.push(mkStatic('Carlow', vsMatch[1].trim(), vsMatch[2].trim(), date, timePart, venue, comp.name, round));
    }
    return fixtures;
  } catch (e) {
    console.error('fetchCarlowFixtures failed:', e);
    return [];
  }
}

// ---- Carlow: static data ----
// Static fixtures are kept as a fallback / supplement for competitions not
// on carlowgaa.ie, and for historical rounds already passed.
const CARLOW_FIXTURES = [];

// Carlow - Senior Hurling Championship
[
 ['Naomh Moling','Ballinkillen','26 June 2026','19:30','McGrath Park Bagenalstown','Round 1'],
 ['Bagenalstown Gaels GAA','Naomh Eoin','27 June 2026','17:00','Netwatch Cullen Park, Carlow','Round 1'],
 ['Naomh Brid GAA','Mt Leinster Rangers','27 June 2026','18:30','Netwatch Cullen Park, Carlow','Round 1'],
 ['Mt Leinster Rangers','Bagenalstown Gaels GAA','3 July 2026','19:30','Pitch 1 Training Centre','Round 2'],
 ['Ballinkillen','Naomh Brid GAA','4 July 2026','17:00','Netwatch Cullen Park, Carlow','Round 2'],
 ['Naomh Moling','Naomh Eoin','4 July 2026','18:30','Netwatch Cullen Park, Carlow','Round 2'],
 ['Naomh Moling','Naomh Brid GAA','10 July 2026','19:30','McGrath Park Bagenalstown','Round 3'],
 ['Mt Leinster Rangers','Naomh Eoin','11 July 2026','17:00','Netwatch Cullen Park, Carlow','Round 3'],
 ['Ballinkillen','Bagenalstown Gaels GAA','11 July 2026','18:30','Netwatch Cullen Park, Carlow','Round 3'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Senior Hurling Championship',r[5])));

// Carlow - Intermediate Hurling Championship
[
 ['Kildavin / Clonegal','Naomh Eoin','21 June 2026','18:00','Spellman Park','Round 1'],
 ['Bagenalstown Gaels GAA','Burren Rangers Hurling and Camogie Club','21 June 2026','18:00','McGrath Park Bagenalstown','Round 1'],
 ['Mt Leinster Rangers','Naomh Moling','21 June 2026','18:00','Mount Leinster Rangers','Round 1'],
 ['Kildavin / Clonegal','Carlow Town Hurling Club','28 June 2026','18:00','Spellman Park','Round 2'],
 ['Naomh Moling','Naomh Eoin','28 June 2026','18:00','Naomh Moling','Round 2'],
 ['Mt Leinster Rangers','Bagenalstown Gaels GAA','28 June 2026','18:00','Mount Leinster Rangers','Round 2'],
 ['Carlow Town Hurling Club','Mt Leinster Rangers','5 July 2026','18:00','Carlow Town HC','Round 3'],
 ['Bagenalstown Gaels GAA','Naomh Eoin','5 July 2026','18:00','McGrath Park Bagenalstown','Round 3'],
 ['Burren Rangers Hurling and Camogie Club','Naomh Moling','5 July 2026','18:00','Kilbride G.F.C.','Round 3'],
 ['Burren Rangers Hurling and Camogie Club','Kildavin / Clonegal','11 July 2026','19:00','Kilbride G.F.C.','Round 4'],
 ['Naomh Eoin','Carlow Town Hurling Club','12 July 2026','18:00','Myshall','Round 4'],
 ['Naomh Moling','Bagenalstown Gaels GAA','12 July 2026','18:00','Naomh Moling','Round 4'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Intermediate Hurling Championship',r[5])));

// Carlow - Senior Hurling Championship Rounds 4-5 (source: carlowgaa.ie/fixtures/ Aug 2026)
[
 ['Naomh Eoin','Ballinkillen','8 August 2026','17:30','Netwatch Cullen Park, Carlow','Round 4'],
 ['Naomh Moling','Mt Leinster Rangers','8 August 2026','19:00','Netwatch Cullen Park, Carlow','Round 4'],
 ['Naomh Brid GAA','Bagenalstown Gaels GAA','9 August 2026','18:00','Netwatch Cullen Park, Carlow','Round 4'],
 ['Naomh Moling','Bagenalstown Gaels GAA','14 August 2026','19:30','Netwatch Cullen Park, Carlow','Round 5'],
 ['Naomh Brid GAA','Naomh Eoin','15 August 2026','17:30','Netwatch Cullen Park, Carlow','Round 5'],
 ['Mt Leinster Rangers','Ballinkillen','15 August 2026','19:00','Mount Leinster Rangers','Round 5'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Senior Hurling Championship',r[5])));

// Carlow - Intermediate Hurling Championship Rounds 5-6 (source: carlowgaa.ie/fixtures/ Aug 2026)
// Fixtures with TBA opponents omitted
[
 ['Mt Leinster Rangers','Kildavin / Clonegal','7 August 2026','20:00','Mount Leinster Rangers','Round 5'],
 ['Burren Rangers Hurling and Camogie Club','Mt Leinster Rangers','10 August 2026','19:30','Kilbride G.F.C.','Round 5'],
 ['Kildavin / Clonegal','Bagenalstown Gaels GAA','15 August 2026','19:30','Spellman Park','Round 6'],
 ['Naomh Eoin','Mt Leinster Rangers','16 August 2026','18:00','Myshall','Round 6'],
 ['Carlow Town Hurling Club','Burren Rangers Hurling and Camogie Club','16 August 2026','18:00','Carlow Town HC','Round 6'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Intermediate Hurling Championship',r[5])));

// Carlow - Junior Hurling Championship (source: carlowgaa.ie/fixtures/ Aug 2026)
[
 ['Carlow Town Hurling Club','Ballinkillen','8 August 2026','19:30','Carlow Town HC','Round 1'],
 ['Mt Leinster Rangers','Naomh Brid GAA','9 August 2026','12:30','Mount Leinster Rangers','Round 1'],
 ['Naomh Moling','Burren Rangers Hurling and Camogie Club','9 August 2026','12:30','Pairc Naomh Moling','Round 1'],
 ['Naomh Eoin','Carlow Town Hurling Club','12 August 2026','19:30','Myshall','Round 2'],
 ['Setanta Ceatharlach','Burren Rangers Hurling and Camogie Club','12 August 2026','19:30','Pres College','Round 2'],
 ['Mt Leinster Rangers','Ballinkillen','12 August 2026','19:30','Mount Leinster Rangers','Round 2'],
 ['Naomh Brid GAA','Naomh Moling','13 August 2026','19:30','Naomh Brid - Superbowl','Round 2'],
 ['Burren Rangers Hurling and Camogie Club','Carlow Town Hurling Club','16 August 2026','12:30','Kilbride GAA','Round 3'],
 ['Mt Leinster Rangers','Naomh Moling','16 August 2026','12:30','Mount Leinster Rangers','Round 3'],
 ['Setanta Ceatharlach','Naomh Brid GAA','16 August 2026','12:30','Pres College','Round 3'],
 ['Ballinkillen','Naomh Eoin','16 August 2026','12:30','Ballinkillen','Round 3'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior Hurling Championship',r[5])));

// Carlow Football Championship - Rounds 1-3
// Senior Football Championship
[
  ['Old Leighlin','Fenagh','16 July 2026','20:30','NCP','Round 1'],
  ['Bagenalstown','Eire Og','16 July 2026','19:00','NCP','Round 1'],
  ['Rathvilly','Grange','17 July 2026','20:30','NCP','Round 1'],
  ['Palatine','MLR','18 July 2026','18:00','NCP','Round 1'],
  ['Rathvilly','Bagenalstown','23 July 2026','19:30','NCP','Round 2'],
  ['Old Leighlin','Palatine','24 July 2026','20:30','NCP','Round 2'],
  ['Fenagh','Grange','24 July 2026','19:00','NCP','Round 2'],
  ['Eire Og','MLR','25 July 2026','19:30','NCP','Round 2'],
  ['Rathvilly','Palatine','31 July 2026','20:30','NCP','Round 3'],
  ['Bagenalstown','Grange','1 August 2026','18:00','NCP','Round 3'],
  ['Old Leighlin','Eire Og','1 August 2026','19:30','NCP','Round 3'],
  ['Fenagh','MLR','2 August 2026','16:00','Spellman Park','Round 3'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship',r[5])));

// Intermediate Football Championship
[
  ['St.Patricks','Tinryland','16 July 2026','19:30','COE','Round 1'],
  ['Fighting Cocks','Clonmore','17 July 2026','19:30','Br. Leo Park','Round 1'],
  ['Kildavin/Clonegal','Eire Og','17 July 2026','19:00','NCP','Round 1'],
  ['Ballinabranna','Ballon','17 July 2026','19:30','COE','Round 1'],
  ['Fighting Cocks','Eire Og','23 July 2026','19:30','COE','Round 2'],
  ['Tinryland','Clonmore','24 July 2026','19:30','COE','Round 2'],
  ['Kildavin/Clonegal','Ballinabranna','24 July 2026','19:30','Br. Leo Park','Round 2'],
  ['St.Patricks','Ballon','25 July 2026','18:00','NCP','Round 2'],
  ['Fighting Cocks','Ballon','31 July 2026','19:00','NCP','Round 3'],
  ['Tinryland','Kildavin/Clonegal','1 August 2026','18:00','COE','Round 3'],
  ['Ballinabranna','Eire Og','2 August 2026','14:30','McGrath Park','Round 3'],
  ['St.Patricks','Clonmore','2 August 2026','14:30','Spellman Park','Round 3'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship',r[5])));

// Junior A Football Championship
[
  ['Asca','Naomh Eoin','16 July 2026','19:30','Pres College','Round 1'],
  ['Leighlinbridge','Palatine','18 July 2026','19:30','NCP','Round 1'],
  ['Kilbride','O Hanrahans','18 July 2026','19:30','COE','Round 1'],
  ['Eire Og','Rathvilly','18 July 2026','19:30','Pairc Ui Bhriain','Round 1'],
  ['Leighlinbridge','Naomh Eoin','23 July 2026','19:30','Leighlinbridge','Round 2'],
  ['Asca','Eire Og','24 July 2026','19:30','Pres College','Round 2'],
  ['Palatine','Kilbride','25 July 2026','19:30','Palatine','Round 2'],
  ['O Hanrahans','Rathvilly','25 July 2026','19:30','O Hanrahans','Round 2'],
  ['Naomh Eoin','Eire Og','31 July 2026','19:30','Myshall','Round 3'],
  ['Kilbride','Leighlinbridge','31 July 2026','19:30','Kilbride','Round 3'],
  ['O Hanrahans','Palatine','1 August 2026','19:30','O Hanrahans','Round 3'],
  ['Rathvilly','Asca','2 August 2026','18:00','Fr. Ryan Park','Round 3'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior A Football Championship',r[5])));

// Junior B Football Championship
[
  ['St.Patricks','Tinryland','18 July 2026','18:00','Br. Leo Park','Round 1'],
  ['Naomh Eoin','Clonmore','18 July 2026','18:00','Myshall','Round 1'],
  ['Bagenalstown','Kildavin','18 July 2026','18:00','McGrath Park','Round 1'],
  ['Old Leighlin','Ballinabranna','18 July 2026','18:00','Old Leighlin','Round 1'],
  ['Bagenalstown','St.Patricks','24 July 2026','19:30','McGrath Park','Round 2'],
  ['Kildavin','Old Leighlin','25 July 2026','18:00','Spellman Park','Round 2'],
  ['Naomh Eoin','Tinryland','25 July 2026','18:00','Myshall','Round 2'],
  ['Clonmore','Ballinabranna','25 July 2026','18:00','Clonmore','Round 2'],
  ['Kildavin','Clonmore','31 July 2026','19:30','Spellman Park','Round 3'],
  ['Tinryland','Ballinabranna','31 July 2026','19:30','Tinryland','Round 3'],
  ['St.Patricks','Naomh Eoin','1 August 2026','18:00','Br. Leo Park','Round 3'],
  ['Old Leighlin','Bagenalstown','2 August 2026','18:00','Old Leighlin','Round 3'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior B Football Championship',r[5])));

// Junior C Football Championship
[
  ['St.Patricks','Ballon','22 July 2026','19:30','Br. Leo Park','Round 1'],
  ['Palatine','Fighting Cocks','22 July 2026','19:30','Palatine','Round 1'],
  ['Palatine','St.Patricks','29 July 2026','19:30','Palatine','Round 2'],
  ['Fenagh','O Hanrahans','29 July 2026','19:30','JJ Hogan Park','Round 2'],
  ['Ballon','MLR','29 July 2026','19:30','Ballon','Round 2'],
  ['Asca','Grange','29 July 2026','19:30','Pres College','Round 2'],
  ['St.Patricks','Fighting Cocks','3 August 2026','19:30','Br. Leo Park','Round 3'],
  ['Asca','Fenagh','3 August 2026','19:30','Pres College','Round 3'],
  ['MLR','Palatine','3 August 2026','19:30','MLR','Round 3'],
  ['Grange','O Hanrahans','3 August 2026','19:30','Grange','Round 3'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior C Football Championship',r[5])));

// Carlow - Senior Football Championship QFs (source: carlowgaa.ie Aug 2026)
[
  ['Rathvilly/Rathbhile','Fenagh','25 August 2026','20:30','Netwatch Cullen Park','QF'],
  ['Bagenalstown Gaels GAA','Old Leighlin','26 August 2026','20:30','Netwatch Cullen Park','QF'],
  ['Mt Leinster Rangers','Grange','27 August 2026','19:00','Netwatch Cullen Park','QF'],
  ['Eire Og','Palatine','27 August 2026','20:30','Netwatch Cullen Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship',r[5])));

// Carlow - Senior Football Championship SFs (source: carlowgaa.ie Sep 2026)
[
  ['Fenagh','Mt Leinster Rangers','9 September 2026','20:30','Netwatch Cullen Park','Relegation Final'],
  ['Palatine','Grange','12 September 2026','19:00','Netwatch Cullen Park','QF'],
  ['Old Leighlin','Bagenalstown Gaels GAA','13 September 2026','16:00','Netwatch Cullen Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship',r[5])));

// Carlow - Intermediate Football Championship QFs (source: carlowgaa.ie Aug 2026)
[
  ['Eire Og','Tinryland','25 August 2026','19:00','Netwatch Cullen Park','QF'],
  ['Ballinabranna','Clonmore','26 August 2026','19:00','Netwatch Cullen Park','QF'],
  ['Kildavin/Clonegal','Ballon','27 August 2026','19:30','Netwatch Cullen Park','QF'],
  ['Fighting Cocks','St Patricks','27 August 2026','20:15','Fr Ryan Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship',r[5])));

// Carlow - Intermediate Football Championship SFs (source: carlowgaa.ie Sep 2026)
[
  ['Ballinabranna','Clonmore','9 September 2026','19:00','Netwatch Cullen Park','Relegation Final'],
  ['Kildavin / Clonegal','Eire Og','12 September 2026','17:15','Netwatch Cullen Park','QF'],
  ['Fighting Cocks','Ballon GFC','13 September 2026','14:15','Netwatch Cullen Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship',r[5])));

// Carlow - Junior A Football Championship QFs (source: carlowgaa.ie Aug 2026)
[
  ['O Hanrahans','Asca','25 August 2026','19:00','O Hanrahans','QF'],
  ['Leighlinbridge','Eire Og','26 August 2026','19:00','Paul Monahan Park','QF'],
  ['Kilbride','Naomh Eoin','27 August 2026','19:00','Kilbride','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior A Football Championship',r[5])));

// Carlow - Junior B Football Championship QFs (source: carlowgaa.ie Aug 2026)
[
  ['Ballinabranna','St Patricks','25 August 2026','19:00','Baile na mBrannach','QF'],
  ['Naomh Eoin','Kildavin/Clonegal','25 August 2026','20:00','Naomh Eoin','QF'],
  ['Tinryland','Bagenalstown Gaels GAA','27 August 2026','19:00','Tinryland','QF'],
  ['Clonmore','Old Leighlin','27 August 2026','20:00','Clonmore','QF'],
  ['St Patricks','Clonmore','2 September 2026','20:00','Br. Leo Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior B Football Championship',r[5])));

// Carlow - Junior C Football Championship QFs (source: carlowgaa.ie Aug 2026)
[
  ['Fighting Cocks','Mt Leinster Rangers','26 August 2026','19:30','Fighting Cocks','QF'],
  ['Asca','Fenagh','26 August 2026','19:30','Pres College','QF'],
  ['Ballon','Palatine','26 August 2026','20:00','Ballon','QF'],
  ['Grange','O Hanrahans','26 August 2026','20:15','Grange','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior C Football Championship',r[5])));

// Carlow - Junior A Football Championship SFs (source: carlowgaa.ie Sep 2026)
[
  ['Palatine','Asca','11 September 2026','19:00','Netwatch Cullen Park','QF'],
  ['Naomh Eoin','Kilbride/Cill Bhríde C.L.G.','11 September 2026','20:30','Netwatch Cullen Park','QF'],
  ['Rathvilly/Rathbhile','Eire Og Clg','16 September 2026','20:00','Pitch 1 Netwatch Centre of Excellence','Relegation Final'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior A Football Championship',r[5])));

// Carlow - Junior B Football Championship SFs (source: carlowgaa.ie Sep 2026)
[
  ['OldLeighlin','Naomh Eoin','10 September 2026','20:00','Pitch 1 Netwatch Centre of Excellence','QF'],
  ['Kildavin / Clonegal','Tinryland/Tigh Raoireann','11 September 2026','20:00','Pitch 1 Netwatch Centre of Excellence','QF'],
  ['Bagenalstown Gaels GAA','Ballinabranna','16 September 2026','19:30','Pitch 2 Netwatch Centre of Excellence','Relegation Final'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior B Football Championship',r[5])));

// Carlow - Junior C Football Championship SFs (source: carlowgaa.ie Sep 2026)
[
  ['Palatine','Grange','10 September 2026','19:30','Pitch 2 Netwatch Centre of Excellence','QF'],
  ['St Patricks','O\'Hanrahans/Ó Hanracháin','11 September 2026','19:30','Pitch 2 Netwatch Centre of Excellence','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior C Football Championship',r[5])));

// Carlow - Junior Hurling Championship (source: carlowgaa.ie Sep 2026)
[
  ['Naomh Eoin','Burren Rangers','4 September 2026','19:00','Netwatch Cullen Park','QF'],
  ['Carlow Town Hurling Club','Ballinkillen','4 September 2026','19:00','Netwatch Cullen Park','QF'],
  ['Naomh Brid GAA','Setanta Ceatharlach','4 September 2026','19:30','Netwatch Cullen Park','QF'],
  ['Naomh Moling','Mt Leinster Rangers','4 September 2026','20:30','Netwatch Cullen Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior Hurling Championship',r[5])));

// Carlow - Junior Hurling Championship Finals (source: carlowgaa.ie Sep 2026)
[
  ['Burren Rangers Hurling and Camogie Club','Setanta Ceatharlach','24 September 2026','19:30','Netwatch Cullen Park, Carlow','Shield Final'],
  ['Ballinkillen','Naomh Moling','27 September 2026','14:00','Netwatch Cullen Park, Carlow','Final'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior Hurling Championship',r[5])));

// Carlow - Senior Hurling Championship Final (source: carlowgaa.ie Sep 2026)
[
  ['Naomh Moling','Mt Leinster Rangers','26 September 2026','19:30','Netwatch Cullen Park, Carlow','Final'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Senior Hurling Championship',r[5])));

// Carlow - Intermediate Hurling Championship Final (source: carlowgaa.ie Sep 2026)
[
  ['Carlow Town Hurling Club','Burren Rangers Hurling and Camogie Club','27 September 2026','16:00','Netwatch Cullen Park, Carlow','Final'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Intermediate Hurling Championship',r[5])));

// Carlow - Intermediate Hurling Championship QFs (source: carlowgaa.ie Sep 2026)
[
  ['Burren Rangers','Mt Leinster Rangers','5 September 2026','17:00','Netwatch Cullen Park','QF'],
  ['Carlow Town Hurling Club','Bagenalstown Gaels GAA','5 September 2026','18:45','Netwatch Cullen Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Intermediate Hurling Championship',r[5])));

// Carlow - Senior Hurling Championship QFs (source: carlowgaa.ie Sep 2026)
[
  ['Ballinkillen','Naomh Moling','6 September 2026','14:15','Netwatch Cullen Park','QF'],
  ['Mt Leinster Rangers','Bagenalstown Gaels GAA','6 September 2026','16:00','Netwatch Cullen Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Senior Hurling Championship',r[5])));

// ---- Louth: live scraper ----
// Scrapes louthgaa.ie/fixtures-results/?countyBoardID=20&fixturesOnly=Y&daysAfter=60
// Imports all adult competitions; strips sponsor prefixes from comp names; excludes underage.
// Falls back to empty array if the fetch fails.
async function fetchLouthFixtures() {
  const UNDERAGE_RE = /\bU\d+\b|\bMinor\b|\bJuvenile\b|\bYouth\b|\bUnder[ -]?\d+\b|\bCoiste na n[Óó]g\b/i;
  try {
    const res = await fetch(
      'https://louthgaa.ie/fixtures-results/?countyBoardID=20&fixturesOnly=Y&daysAfter=60',
      { headers: { 'User-Agent': UA } }
    );
    if (!res.ok) return [];
    const html = await res.text();
    const decEnt = s => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&#8217;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[\u2018\u2019\u0060]/g, "'").replace(/[\u201c\u201d]/g, '"');

    // Date line pattern: "Thursday 20th August 2026"
    const dateLine = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+(\d+)(?:st|nd|rd|th)\s+(\w+)\s+(\d{4})$/i;
    // Time pattern: "8 00 PM" or "12 30 PM" (site omits colon, uses spaces)
    const timeParse = (t) => {
      const m = t.match(/^(\d+)\s+(\d{2})\s+(AM|PM)$/i);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const min = m[2];
      const ampm = m[3].toUpperCase();
      if (ampm === 'PM' && h !== 12) h += 12;
      if (ampm === 'AM' && h === 12) h = 0;
      return `${String(h).padStart(2,'0')}:${min}`;
    };
    const tdRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const stripTags = s => s.replace(/<[^>]+>/g, '').trim();

    // The page structure:
    //   ...(date heading in text)...
    //   <span class='compHead'><a>Competition Name</a></span>
    //   <table class="fixturesresults"><tr><th>...</th><tr class="d1"><td>...</td>...</table>
    // NOTE: <tr> rows have NO closing </tr> tags, so we split by <tr[^>]*> openers.

    const fixtures = [];
    let currentDate = null;
    let currentComp = null;

    // Split HTML at <table boundaries; text segments hold dates/comp headings,
    // table segments hold fixture rows.
    const tableRe = /(<table[^>]*>)([\s\S]*?)(<\/table>)/gi;
    const segments2 = [];
    let lastEnd2 = 0;
    let tblMatch;
    tableRe.lastIndex = 0;
    while ((tblMatch = tableRe.exec(html)) !== null) {
      if (tblMatch.index > lastEnd2) segments2.push({ type: 'text', content: html.slice(lastEnd2, tblMatch.index) });
      segments2.push({ type: 'table', open: tblMatch[1], content: tblMatch[2] });
      lastEnd2 = tableRe.lastIndex;
    }
    if (lastEnd2 < html.length) segments2.push({ type: 'text', content: html.slice(lastEnd2) });

    // Regex to extract <span class='compHead'> text specifically (not generic page text)
    const compHeadRe = /<span[^>]*compHead[^>]*>([\s\S]*?)<\/span>/i;

    for (const seg of segments2) {
      if (seg.type === 'text') {
        // Only pick up date headings from plain text; comp headings ONLY from compHead spans
        const plainText = seg.content.replace(/<[^>]+>/g, '\n').split('\n').map(l => decEnt(l.trim())).filter(l => l.length > 0);
        for (const line of plainText) {
          const dm = line.match(dateLine);
          if (dm) { currentDate = `${parseInt(dm[1],10)} ${dm[2]} ${dm[3]}`; }
        }
        // Extract competition heading from compHead span specifically
        const chm = compHeadRe.exec(seg.content);
        if (chm) {
          const compText = decEnt(stripTags(chm[1])).trim();
          if (UNDERAGE_RE.test(compText)) {
            currentComp = null; // skip underage
          } else {
            const code = /hurling/i.test(compText) ? 'Hurling' : 'Football';
            currentComp = { name: compText, code };
          }
        }
      } else {
        // Only parse fixture tables
        if (!seg.open.includes('fixturesresults')) continue;
        if (!currentComp || !currentDate) continue;
        // Split table content by <tr> openers (rows have no </tr> closing tags)
        const rowSegs = seg.content.split(/<tr[^>]*>/i);
        for (const rowSeg of rowSegs) {
          // Extract <td>/<th> cells from this row segment
          const cells = [];
          let cellMatch;
          tdRe.lastIndex = 0;
          while ((cellMatch = tdRe.exec(rowSeg)) !== null) {
            cells.push(decEnt(stripTags(cellMatch[1])).trim());
          }
          if (cells.length < 5) continue;
          if (/^Time$/i.test(cells[0])) continue; // header row
          const time24 = timeParse(cells[0]);
          if (!time24) continue;
          const teamA = cells[1];
          const teamB = cells[4];
          const venue = cells[5] || '';
          const round = cells[7] || '';
          if (!teamA || !teamB || /^Winner|^Loser/i.test(teamA) || /^Winner|^Loser/i.test(teamB)) continue;
          const compName = currentComp.name.replace(/^(?:Anchor Tours|CTI Business Solutions|DKIT Sport|LMFM)\s+/i, '').trim();
          const f = mkStatic('Louth', teamA, teamB, currentDate, time24, venue, compName, round);
          f.code = currentComp.code;
          fixtures.push(f);
        }
      }
    }
    return fixtures;
  } catch (e) {
    return [];
  }
}

// ---- Tipperary Camogie: live scraper (tipperarycamogie.com / Sportlomo) ----
async function fetchTipperaryCamogieFixtures() {
  const MONTHS_SHORT = {Jan:'January',Feb:'February',Mar:'March',Apr:'April',May:'May',Jun:'June',Jul:'July',Aug:'August',Sep:'September',Oct:'October',Nov:'November',Dec:'December'};
  const sportlomoDate = d => { const [day, mon, year] = d.split(' '); return `${parseInt(day,10)} ${MONTHS_SHORT[mon] || mon} ${year}`; };
  const LEAGUES = [
    { id: 216795, comp: 'Senior Camogie Championship' },
    { id: 216796, comp: 'Senior Camogie Championship' },
    { id: 216797, comp: 'Intermediate Camogie Championship' },
    { id: 216798, comp: 'Intermediate Camogie Championship' },
  ];
  const fixtureRe = /class="[^"]*table-body fixtures[^"]*"[^>]*data-date="([^"]+)"[^>]*data-time="([^"]*)"[^>]*data-hometeam="([^"]+)"[^>]*data-awayteam="([^"]+)"[^>]*data-homescore="([^"]*)"[^>]*data-awayscore="([^"]*)"[^>]*data-venue="([^"]*)"/g;
  const all = [];
  await Promise.all(LEAGUES.map(async ({ id, comp }) => {
    try {
      const res = await fetch(`https://tipperarycamogie.com/league/${id}/`, { headers: { 'User-Agent': UA } });
      if (!res.ok) return;
      const html = await res.text();
      fixtureRe.lastIndex = 0;
      let m;
      while ((m = fixtureRe.exec(html)) !== null) {
        const [, date, time, home, away, homeScore, awayScore, venue] = m;
        if (homeScore || awayScore) continue;
        all.push({ ...mkStatic('Tipperary', home.trim(), away.trim(), sportlomoDate(date), time.trim(), venue.trim(), comp, ''), sport: 'Camogie' });
      }
    } catch (e) { /* skip */ }
  }));
  return all;
}

// ---- Louth: static data ----
// Static fixtures supplement the live scraper above (covers rounds beyond 21-day window
// and Junior Championship which is not scraped live).
const LOUTH_FIXTURES = [];

// Louth - Junior Football Championship Group 1
[
  ['Naomh Malachi','Annaghminnon Rovers','15 August 2026','17:00','Páirc de Róiste','Round 1'],
  ['Winner of Round 1','Cuchulainn Gaels','22 August 2026','17:00','Dundalk Gaels','Round 2'],
  ['Cuchulainn Gaels','Loser of Round 1','28 August 2026','20:00','Páirc de Róiste','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Junior Football Championship Group 1',r[5])));

// Louth - Junior Football Championship Group 2
[
  ['Westerns','Glyde Rangers','17 August 2026','20:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 1'],
  ['Winner of Round 1','St Nicholas','23 August 2026','16:00','The Grove','Round 2'],
  ['St Nicholas','Loser of Round 1','29 August 2026','17:30','Shawport Páirc Mac Diarmada','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Junior Football Championship Group 2',r[5])));

// Louth - Junior Football Championship Group 3
[
  ['Lann Leire G.F.C.','Dowdallshill','16 August 2026','14:00','Shawport Páirc Mac Diarmada','Round 1'],
  ['Dundalk Young Irelands','O\'Connells','16 August 2026','16:30','Páirc Uí Taibh','Round 1'],
  ['Lann Léire C.P.G.','Dundalk Young Irelands','22 August 2026','19:30','Stabannon Parnells','Round 2'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Junior Football Championship Group 3',r[5])));

// Louth - Junior Football Championship Group 4
[
  ['Na Piarsaigh - Blackrock','Sean McDermotts','15 August 2026','19:30','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 1'],
  ['John Mitchels','St Finbarrs','16 August 2026','19:00','Páirc Baile Fiach','Round 1'],
  ['Sean McDermotts','John Mitchels','22 August 2026','16:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 2'],
  ['Na Piarsaigh - Blackrock','Naomh Fionnbarra','23 August 2026','12:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 2'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Junior Football Championship Group 4',r[5])));

// Louth - Senior Football Championship Group 1
[
  ['St Josephs','St Fechins','23 August 2026','18:00','Páirc Uí Mhuirí, Dunleer','Round 1'],
  ['Winner of Round 1','Naomh Mairtin','31 August 2026','20:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 2'],
  ['Naomh Mairtin','Loser of Round 1','6 September 2026','14:00','DEFY Páirc Mhuire, Ardee','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group 1',r[5])));

// Louth - Senior Football Championship Group 2
[
  ['St Marys','St Mochtas','24 August 2026','20:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 1'],
  ['Winner of Round 1','Hunterstown Rovers','30 August 2026','19:30','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 2'],
  ['Hunterstown Rovers','Loser of Round 1','6 September 2026','19:30','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group 2',r[5])));

// Louth - Senior Football Championship Group 3
[
  ['Newtown Blues','Dreadnots','22 August 2026','18:00','Integral GAA Grounds, Drogheda','Round 1'],
  ['Winner of Round 1','Cooley Kickhams','29 August 2026','20:00','Páirc Séamus Mhic hEochaidh, Haggardstown','Round 2'],
  ['Cooley Kickhams','Loser of Round 1','7 September 2026','20:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group 3',r[5])));

// Louth - Senior Football Championship Group 4
[
  ['Roche Emmets','Dundalk Gaels','23 August 2026','14:00','Fr McEvoy Park, Cooley','Round 1'],
  ['Winner of Round 1','St Patricks','30 August 2026','17:00','Páirc Séamus Mhic hEochaidh, Haggardstown','Round 2'],
  ['St Patricks','Loser of Round 1','5 September 2026','18:00','Páirc Séamus Mhic hEochaidh, Haggardstown','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group 4',r[5])));

// Louth - Intermediate Football Championship Group 1
[
  ['Glen Emmets','O\'Raghallaighs','29 August 2026','18:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 1'],
  ['Winner of Round 1','Stabannon Parnells','5 September 2026','16:00','Páirc Uí Mhuirí, Dunleer','Round 2'],
  ['Stabannon Parnells','Loser of Round 1','13 September 2026','14:00','DEFY Páirc Mhuire, Ardee','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group 1',r[5])));

// Louth - Intermediate Football Championship Group 2
[
  ['Wolfe Tones','Oliver Plunketts','30 August 2026','16:00','Integral GAA Grounds, Drogheda','Round 1'],
  ['Winner of Round 1','Kilkerley Emmets','4 September 2026','20:00','Stabannon Parnells','Round 2'],
  ['Kilkerley Emmets','Loser of Round 1','12 September 2026','17:00','The Grove','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group 2',r[5])));

// Louth - Intermediate Football Championship Group 3
[
  ['St Brides','Geraldines','28 August 2026','20:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 1'],
  ['Winner of Round 1','Clan Na Gael','5 September 2026','20:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 2'],
  ['Clan Na Gael','Loser of Round 1','12 September 2026','19:30','Fr McEvoy Park, Cooley','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group 3',r[5])));

// Louth - Intermediate Football Championship Group 4
[
  ['St. Kevins','Mattock Rangers','30 August 2026','14:00','DEFY Páirc Mhuire, Ardee','Round 1'],
  ['Winner of Round 1','Sean O\'Mahonys','6 September 2026','17:00','Pairc Naomh Brid','Round 2'],
  ['Sean O\'Mahonys','Loser of Round 1','14 September 2026','20:00','Cullen Auto Parts Louth GAA Training Centre, Darver','Round 3'],
].forEach(r=>LOUTH_FIXTURES.push(mkStatic('Louth',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group 4',r[5])));

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ---- Auth helpers ----
const USERS_KV_KEY    = 'auth_users';
const SESSION_PREFIX  = 'auth_session:';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function pbkdf2Hash(password, saltHex) {
  const enc = new TextEncoder();
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = hexToBytes(saltHex);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 },
    keyMat, 256
  );
  return bytesToHex(new Uint8Array(bits));
}

function randomHex(bytes = 32) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}
function bytesToHex(buf) {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hexToBytes(hex) {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i*2, i*2+2), 16);
  return arr;
}

async function getUsers(kv)   { return JSON.parse(await kv.get(USERS_KV_KEY) || '{}'); }
async function putUsers(kv, u) { await kv.put(USERS_KV_KEY, JSON.stringify(u)); }

async function validateSession(kv, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  const raw = await kv.get(SESSION_PREFIX + token);
  if (!raw) return null;
  const session = JSON.parse(raw);
  return session.username || null;
}

async function handleAuth(action, body, kv, request, adminKey) {
  // ---- login ----
  if (action === 'login') {
    const { username, password } = body || {};
    if (!username || !password) return jsonResp({ ok: false, error: 'Missing credentials' }, 400);
    const users = await getUsers(kv);
    const user = users[username.toLowerCase()];
    if (!user) return jsonResp({ ok: false, error: 'Invalid username or password' }, 401);
    const hash = await pbkdf2Hash(password, user.salt);
    if (hash !== user.hash) return jsonResp({ ok: false, error: 'Invalid username or password' }, 401);
    const token = randomHex(32);
    await kv.put(SESSION_PREFIX + token, JSON.stringify({ username: username.toLowerCase(), createdAt: new Date().toISOString() }), { expirationTtl: SESSION_TTL_SEC });
    return jsonResp({ ok: true, token, mustChangePassword: !!user.mustChangePassword, username: username.toLowerCase() });
  }

  // ---- logout ----
  if (action === 'logout') {
    const { token } = body || {};
    if (token) await kv.delete(SESSION_PREFIX + token);
    return jsonResp({ ok: true });
  }

  // ---- validateSession ----
  if (action === 'validateSession') {
    const username = await validateSession(kv, request);
    if (!username) return jsonResp({ ok: false, error: 'Invalid or expired session' }, 401);
    return jsonResp({ ok: true, username });
  }

  // ---- changePassword (requires valid session) ----
  if (action === 'changePassword') {
    const username = await validateSession(kv, request);
    if (!username) return jsonResp({ ok: false, error: 'Not authenticated' }, 401);
    const { newPassword } = body || {};
    if (!newPassword || newPassword.length < 8) return jsonResp({ ok: false, error: 'Password must be at least 8 characters' }, 400);
    const users = await getUsers(kv);
    if (!users[username]) return jsonResp({ ok: false, error: 'User not found' }, 404);
    const salt = randomHex(16);
    users[username].salt = salt;
    users[username].hash = await pbkdf2Hash(newPassword, salt);
    users[username].mustChangePassword = false;
    await putUsers(kv, users);
    return jsonResp({ ok: true });
  }

  // ---- adminResetPassword (requires ADMIN_KEY secret) ----
  if (action === 'adminResetPassword') {
    const { adminKey: ak, username, newPassword } = body || {};
    if (!adminKey || ak !== adminKey) return jsonResp({ ok: false, error: 'Forbidden' }, 403);
    if (!username || !newPassword) return jsonResp({ ok: false, error: 'Missing fields' }, 400);
    const users = await getUsers(kv);
    const key = username.toLowerCase();
    const salt = randomHex(16);
    users[key] = {
      ...users[key],
      salt,
      hash: await pbkdf2Hash(newPassword, salt),
      mustChangePassword: true,
      createdAt: users[key]?.createdAt || new Date().toISOString(),
    };
    await putUsers(kv, users);
    return jsonResp({ ok: true });
  }

  // ---- adminCreateUser (requires ADMIN_KEY secret) ----
  if (action === 'adminCreateUser') {
    const { adminKey: ak, username, password } = body || {};
    if (!adminKey || ak !== adminKey) return jsonResp({ ok: false, error: 'Forbidden' }, 403);
    if (!username || !password) return jsonResp({ ok: false, error: 'Missing fields' }, 400);
    const users = await getUsers(kv);
    const key = username.toLowerCase();
    if (users[key]) return jsonResp({ ok: false, error: 'User already exists' }, 409);
    const salt = randomHex(16);
    users[key] = { salt, hash: await pbkdf2Hash(password, salt), mustChangePassword: true, createdAt: new Date().toISOString() };
    await putUsers(kv, users);
    return jsonResp({ ok: true });
  }

  return null; // not an auth action
}

// ---- Championship Rugby: static fixtures (all 15 rounds) ----
// Venue = home team (first listed). Sport = 'Rugby' so dashboard Code column shows 'Rugby'.
const RUGBY_FIXTURES = [];
(function() {
  const add = (round, teamA, teamB, date, time) => {
    const f = mkStatic('Champ', teamA, teamB, date, time, teamA, 'Champ', round);
    f.sport = 'Rugby';
    RUGBY_FIXTURES.push(f);
  };
  // Round 1
  add('Round 1','Nottingham','Blackheath','18 September 2026','19:45');
  add('Round 1','Cornish Pirates','Doncaster Knights','20 September 2026','16:00');
  add('Round 1','Richmond','Ampthill','19 September 2026','17:00');
  add('Round 1','Rotherham Titans','Coventry','19 September 2026','15:00');
  add('Round 1','Chinnor','Ealing Trailfinders','19 September 2026','17:00');
  add('Round 1','Worcester Warriors','Bedford Blues','19 September 2026','15:00');
  add('Round 1','Caldy','Hartpury','19 September 2026','15:00');
  // Round 2
  add('Round 2','Bedford Blues','Chinnor','26 September 2026','15:00');
  add('Round 2','Worcester Warriors','Rotherham Titans','26 September 2026','13:00');
  add('Round 2','Ealing Trailfinders','Richmond','27 September 2026','14:00');
  add('Round 2','Coventry','Cornish Pirates','26 September 2026','15:00');
  add('Round 2','Ampthill','Nottingham','26 September 2026','15:00');
  add('Round 2','Doncaster Knights','Hartpury','27 September 2026','16:00');
  add('Round 2','Blackheath','Caldy','25 September 2026','19:45');
  // Round 3
  add('Round 3','Blackheath','Doncaster Knights','4 October 2026','16:00');
  add('Round 3','Hartpury','Ampthill','2 October 2026','19:45');
  add('Round 3','Nottingham','Coventry','2 October 2026','19:45');
  add('Round 3','Cornish Pirates','Ealing Trailfinders','3 October 2026','15:00');
  add('Round 3','Richmond','Worcester Warriors','3 October 2026','15:00');
  add('Round 3','Rotherham Titans','Bedford Blues','3 October 2026','15:00');
  add('Round 3','Caldy','Chinnor','3 October 2026','13:00');
  // Round 4
  add('Round 4','Coventry','Blackheath','9 October 2026','19:45');
  add('Round 4','Ampthill','Doncaster Knights','10 October 2026','15:00');
  add('Round 4','Chinnor','Richmond','10 October 2026','15:00');
  add('Round 4','Bedford Blues','Cornish Pirates','10 October 2026','17:00');
  add('Round 4','Worcester Warriors','Nottingham','10 October 2026','15:00');
  add('Round 4','Ealing Trailfinders','Hartpury','11 October 2026','16:00');
  add('Round 4','Rotherham Titans','Caldy','9 October 2026','19:45');
  // Round 5
  add('Round 5','Caldy','Ampthill','17 October 2026','15:00');
  add('Round 5','Doncaster Knights','Coventry','17 October 2026','15:00');
  add('Round 5','Blackheath','Ealing Trailfinders','17 October 2026','15:00');
  add('Round 5','Hartpury','Worcester Warriors','17 October 2026','17:00');
  add('Round 5','Nottingham','Bedford Blues','16 October 2026','19:45');
  add('Round 5','Cornish Pirates','Chinnor','17 October 2026','13:00');
  add('Round 5','Richmond','Rotherham Titans','18 October 2026','16:00');
  // Round 6
  add('Round 6','Worcester Warriors','Blackheath','30 October 2026','19:45');
  add('Round 6','Ealing Trailfinders','Doncaster Knights','31 October 2026','15:00');
  add('Round 6','Coventry','Ampthill','31 October 2026','13:00');
  add('Round 6','Rotherham Titans','Cornish Pirates','1 November 2026','16:00');
  add('Round 6','Chinnor','Nottingham','30 October 2026','19:45');
  add('Round 6','Bedford Blues','Hartpury','31 October 2026','15:00');
  add('Round 6','Richmond','Caldy','31 October 2026','15:00');
  // Round 7
  add('Round 7','Caldy','Coventry','7 November 2026','13:00');
  add('Round 7','Ampthill','Ealing Trailfinders','7 November 2026','18:00');
  add('Round 7','Doncaster Knights','Worcester Warriors','7 November 2026','15:00');
  add('Round 7','Blackheath','Bedford Blues','7 November 2026','15:00');
  add('Round 7','Hartpury','Chinnor','8 November 2026','16:00');
  add('Round 7','Nottingham','Rotherham Titans','6 November 2026','19:45');
  add('Round 7','Cornish Pirates','Richmond','7 November 2026','15:00');
  // Round 8
  add('Round 8','Chinnor','Blackheath','14 November 2026','15:00');
  add('Round 8','Bedford Blues','Doncaster Knights','13 November 2026','19:45');
  add('Round 8','Worcester Warriors','Ampthill','15 November 2026','16:00');
  add('Round 8','Ealing Trailfinders','Coventry','15 November 2026','14:00');
  add('Round 8','Richmond','Nottingham','14 November 2026','13:00');
  add('Round 8','Rotherham Titans','Hartpury','14 November 2026','15:00');
  add('Round 8','Cornish Pirates','Caldy','14 November 2026','13:00');
  // Round 9
  add('Round 9','Caldy','Ealing Trailfinders','21 November 2026','13:00');
  add('Round 9','Coventry','Worcester Warriors','21 November 2026','15:00');
  add('Round 9','Ampthill','Bedford Blues','21 November 2026','12:00');
  add('Round 9','Doncaster Knights','Chinnor','21 November 2026','17:00');
  add('Round 9','Blackheath','Rotherham Titans','21 November 2026','15:00');
  add('Round 9','Hartpury','Richmond','21 November 2026','15:00');
  add('Round 9','Nottingham','Cornish Pirates','22 November 2026','16:00');
  // Round 10
  add('Round 10','Richmond','Blackheath','5 December 2026','15:00');
  add('Round 10','Rotherham Titans','Doncaster Knights','5 December 2026','15:00');
  add('Round 10','Chinnor','Ampthill','6 December 2026','16:00');
  add('Round 10','Bedford Blues','Coventry','5 December 2026','15:00');
  add('Round 10','Worcester Warriors','Ealing Trailfinders','5 December 2026','15:00');
  add('Round 10','Cornish Pirates','Hartpury','5 December 2026','15:00');
  add('Round 10','Nottingham','Caldy','4 December 2026','19:45');
  // Round 11
  add('Round 11','Caldy','Worcester Warriors','12 December 2026','13:00');
  add('Round 11','Ealing Trailfinders','Bedford Blues','12 December 2026','15:00');
  add('Round 11','Coventry','Chinnor','13 December 2026','16:00');
  add('Round 11','Ampthill','Rotherham Titans','12 December 2026','13:00');
  add('Round 11','Doncaster Knights','Richmond','12 December 2026','15:00');
  add('Round 11','Blackheath','Cornish Pirates','12 December 2026','17:00');
  add('Round 11','Hartpury','Nottingham','12 December 2026','15:00');
  // Round 12
  add('Round 12','Hartpury','Blackheath','18 December 2026','19:45');
  add('Round 12','Nottingham','Doncaster Knights','18 December 2026','19:45');
  add('Round 12','Cornish Pirates','Ampthill','18 December 2026','19:45');
  add('Round 12','Richmond','Coventry','19 December 2026','15:00');
  add('Round 12','Rotherham Titans','Ealing Trailfinders','19 December 2026','15:00');
  add('Round 12','Chinnor','Worcester Warriors','19 December 2026','15:00');
  add('Round 12','Bedford Blues','Caldy','20 December 2026','16:00');
  // Round 13
  add('Round 13','Ampthill','Blackheath','26 December 2026','13:00');
  add('Round 13','Chinnor','Rotherham Titans','27 December 2026','14:00');
  add('Round 13','Richmond','Bedford Blues','26 December 2026','15:00');
  add('Round 13','Worcester Warriors','Cornish Pirates','26 December 2026','15:00');
  add('Round 13','Ealing Trailfinders','Nottingham','27 December 2026','14:00');
  add('Round 13','Coventry','Hartpury','26 December 2026','15:00');
  add('Round 13','Doncaster Knights','Caldy','26 December 2026','15:00');
  // Round 14
  add('Round 14','Caldy','Doncaster Knights','2 January 2027','13:00');
  add('Round 14','Blackheath','Ampthill','1 January 2027','15:00');
  add('Round 14','Hartpury','Coventry','2 January 2027','15:00');
  add('Round 14','Nottingham','Ealing Trailfinders','1 January 2027','15:00');
  add('Round 14','Cornish Pirates','Worcester Warriors','2 January 2027','15:00');
  add('Round 14','Bedford Blues','Richmond','1 January 2027','15:00');
  add('Round 14','Rotherham Titans','Chinnor','2 January 2027','15:00');
  // Round 15
  add('Round 15','Ealing Trailfinders','Worcester Warriors','23 January 2027','15:00');
  add('Round 15','Coventry','Bedford Blues','23 January 2027','15:00');
  add('Round 15','Ampthill','Chinnor','23 January 2027','13:00');
  add('Round 15','Doncaster Knights','Rotherham Titans','23 January 2027','15:00');
  add('Round 15','Blackheath','Richmond','22 January 2027','19:45');
  add('Round 15','Hartpury','Cornish Pirates','23 January 2027','15:00');
  add('Round 15','Caldy','Nottingham','23 January 2027','13:00');
})();

// BUCS Super Rugby 2026-27
(function() {
  const bucsAdd = (competition, round, teamA, teamB, date, time = 'TBC') => {
    const f = mkStatic('BUCS', teamA, teamB, date, time, teamA, competition, round);
    f.sport = 'Rugby';
    RUGBY_FIXTURES.push(f);
  };
  const W = "Women's BUCS Super Rugby";
  const M = "Men's BUCS Super Rugby";

  // Women's fixtures
  bucsAdd(W,'Round 1','Brunel','Exeter','14 October 2026');
  bucsAdd(W,'Round 1','Cardiff','Surrey','14 October 2026');
  bucsAdd(W,'Round 1','Edinburgh','Cardiff Met','14 October 2026');
  bucsAdd(W,'Round 1','Hartpury','Loughborough','4 November 2026'); // moved from 14 Oct
  bucsAdd(W,'Round 2','Cardiff Met','Brunel','21 October 2026');
  bucsAdd(W,'Round 2','Loughborough','Cardiff','21 October 2026');
  bucsAdd(W,'Round 2','Exeter','Edinburgh','21 October 2026');
  bucsAdd(W,'Round 2','Surrey','Hartpury','21 October 2026');
  bucsAdd(W,'Round 3','Cardiff','Brunel','28 October 2026');
  bucsAdd(W,'Round 3','Surrey','Cardiff Met','28 October 2026');
  bucsAdd(W,'Round 3','Edinburgh','Loughborough','28 October 2026');
  bucsAdd(W,'Round 3','Hartpury','Exeter','28 October 2026');
  bucsAdd(W,'Round 4','Brunel','Edinburgh','11 November 2026');
  bucsAdd(W,'Round 4','Hartpury','Cardiff','11 November 2026');
  bucsAdd(W,'Round 4','Exeter','Cardiff Met','11 November 2026');
  bucsAdd(W,'Round 4','Loughborough','Surrey','11 November 2026');
  bucsAdd(W,'Round 5','Brunel','Loughborough','18 November 2026');
  bucsAdd(W,'Round 5','Cardiff','Exeter','18 November 2026');
  bucsAdd(W,'Round 5','Cardiff Met','Hartpury','18 November 2026');
  bucsAdd(W,'Round 5','Edinburgh','Surrey','18 November 2026');
  bucsAdd(W,'Round 6','Hartpury','Brunel','25 November 2026');
  bucsAdd(W,'Round 6','Cardiff','Edinburgh','25 November 2026');
  bucsAdd(W,'Round 6','Loughborough','Cardiff Met','25 November 2026');
  bucsAdd(W,'Round 6','Surrey','Exeter','25 November 2026');
  bucsAdd(W,'Round 7','Surrey','Brunel','2 December 2026');
  bucsAdd(W,'Round 7','Edinburgh','Hartpury','2 December 2026');
  bucsAdd(W,'Round 7','Exeter','Loughborough','2 December 2026');
  bucsAdd(W,'Round 8','Cardiff Met','Cardiff','9 December 2026');
  bucsAdd(W,'QF','TBD','TBD','24 February 2027');
  bucsAdd(W,'SF','TBD','TBD','3 March 2027');
  bucsAdd(W,'Final','TBD','TBD','17 March 2027');

  // Men's fixtures
  bucsAdd(M,'Round 1','Nottingham','Exeter','23 September 2026');
  bucsAdd(M,'Round 1','Cardiff','Hartpury','23 September 2026');
  bucsAdd(M,'Round 1','Cardiff Met','Brunel','23 September 2026');
  bucsAdd(M,'Round 1','Bath','Loughborough','23 September 2026');
  bucsAdd(M,'Round 1','Leeds Beckett','Durham','23 September 2026');
  bucsAdd(M,'Round 2','Brunel','Bath','30 September 2026');
  bucsAdd(M,'Round 2','Durham','Cardiff','30 September 2026');
  bucsAdd(M,'Round 2','Hartpury','Cardiff Met','30 September 2026');
  bucsAdd(M,'Round 2','Leeds Beckett','Exeter','30 September 2026');
  bucsAdd(M,'Round 2','Loughborough','Nottingham','30 September 2026');
  bucsAdd(M,'Round 3','Hartpury','Bath','7 October 2026');
  bucsAdd(M,'Round 3','Nottingham','Brunel','7 October 2026');
  bucsAdd(M,'Round 3','Cardiff','Cardiff Met','7 October 2026');
  bucsAdd(M,'Round 3','Exeter','Durham','7 October 2026');
  bucsAdd(M,'Round 3','Loughborough','Leeds Beckett','7 October 2026');
  bucsAdd(M,'Round 4','Bath','Exeter','14 October 2026');
  bucsAdd(M,'Round 4','Brunel','Cardiff','14 October 2026');
  bucsAdd(M,'Round 4','Cardiff Met','Loughborough','14 October 2026');
  bucsAdd(M,'Round 4','Durham','Hartpury','14 October 2026');
  bucsAdd(M,'Round 4','Nottingham','Leeds Beckett','14 October 2026');
  bucsAdd(M,'Round 5','Bath','Cardiff Met','21 October 2026');
  bucsAdd(M,'Round 5','Brunel','Exeter','28 October 2026');
  bucsAdd(M,'Round 5','Cardiff','Nottingham','28 October 2026');
  bucsAdd(M,'Round 5','Loughborough','Durham','28 October 2026');
  bucsAdd(M,'Round 5','Leeds Beckett','Hartpury','28 October 2026');
  bucsAdd(M,'Round 6','Nottingham','Bath','4 November 2026');
  bucsAdd(M,'Round 6','Durham','Brunel','4 November 2026');
  bucsAdd(M,'Round 6','Exeter','Cardiff','4 November 2026');
  bucsAdd(M,'Round 6','Leeds Beckett','Cardiff Met','4 November 2026');
  bucsAdd(M,'Round 6','Hartpury','Loughborough','4 November 2026');
  bucsAdd(M,'Round 7','Durham','Bath','11 November 2026');
  bucsAdd(M,'Round 7','Brunel','Loughborough','11 November 2026');
  bucsAdd(M,'Round 7','Cardiff','Leeds Beckett','11 November 2026');
  bucsAdd(M,'Round 7','Cardiff Met','Nottingham','11 November 2026');
  bucsAdd(M,'Round 7','Exeter','Hartpury','11 November 2026');
  bucsAdd(M,'Round 8','Bath','Leeds Beckett','18 November 2026');
  bucsAdd(M,'Round 8','Brunel','Hartpury','18 November 2026');
  bucsAdd(M,'Round 8','Loughborough','Cardiff','18 November 2026');
  bucsAdd(M,'Round 8','Cardiff Met','Exeter','18 November 2026');
  bucsAdd(M,'Round 8','Nottingham','Durham','18 November 2026');
  bucsAdd(M,'Round 9','Cardiff','Bath','2 December 2026');
  bucsAdd(M,'Round 9','Leeds Beckett','Brunel','2 December 2026');
  bucsAdd(M,'Round 9','Durham','Cardiff Met','2 December 2026');
  bucsAdd(M,'Round 9','Exeter','Loughborough','2 December 2026');
  bucsAdd(M,'Round 9','Hartpury','Nottingham','2 December 2026');
  bucsAdd(M,'Round 10','Bath','Durham','9 December 2026');
  bucsAdd(M,'Round 10','Loughborough','Brunel','9 December 2026');
  bucsAdd(M,'Round 10','Cardiff Met','Cardiff','9 December 2026');
  bucsAdd(M,'Round 10','Exeter','Nottingham','9 December 2026');
  bucsAdd(M,'Round 10','Hartpury','Leeds Beckett','9 December 2026');
  bucsAdd(M,'Round 11','Bath','Hartpury','16 December 2026');
  bucsAdd(M,'Round 11','Brunel','Leeds Beckett','16 December 2026');
  bucsAdd(M,'Round 11','Cardiff','Loughborough','16 December 2026');
  bucsAdd(M,'Round 11','Exeter','Cardiff Met','16 December 2026');
  bucsAdd(M,'Round 11','Durham','Nottingham','16 December 2026');
  bucsAdd(M,'Round 12','Bath','Brunel','20 January 2027');
  bucsAdd(M,'Round 12','Leeds Beckett','Cardiff','20 January 2027');
  bucsAdd(M,'Round 12','Loughborough','Cardiff Met','20 January 2027');
  bucsAdd(M,'Round 12','Durham','Exeter','20 January 2027');
  bucsAdd(M,'Round 12','Nottingham','Hartpury','20 January 2027');
  bucsAdd(M,'Round 13','Leeds Beckett','Bath','27 January 2027');
  bucsAdd(M,'Round 13','Exeter','Brunel','27 January 2027');
  bucsAdd(M,'Round 13','Hartpury','Cardiff','27 January 2027');
  bucsAdd(M,'Round 13','Cardiff Met','Durham','27 January 2027');
  bucsAdd(M,'Round 13','Nottingham','Loughborough','27 January 2027');
  bucsAdd(M,'Round 14','Bath','Nottingham','3 February 2027');
  bucsAdd(M,'Round 14','Brunel','Cardiff Met','3 February 2027');
  bucsAdd(M,'Round 14','Cardiff','Exeter','3 February 2027');
  bucsAdd(M,'Round 14','Durham','Leeds Beckett','3 February 2027');
  bucsAdd(M,'Round 14','Loughborough','Hartpury','3 February 2027');
  bucsAdd(M,'Round 15','Cardiff Met','Bath','10 February 2027');
  bucsAdd(M,'Round 15','Brunel','Durham','10 February 2027');
  bucsAdd(M,'Round 15','Nottingham','Cardiff','10 February 2027');
  bucsAdd(M,'Round 15','Hartpury','Exeter','10 February 2027');
  bucsAdd(M,'Round 15','Leeds Beckett','Loughborough','10 February 2027');
  bucsAdd(M,'Round 16','Exeter','Bath','24 February 2027');
  bucsAdd(M,'Round 16','Cardiff','Brunel','24 February 2027');
  bucsAdd(M,'Round 16','Cardiff Met','Hartpury','24 February 2027');
  bucsAdd(M,'Round 16','Durham','Loughborough','24 February 2027');
  bucsAdd(M,'Round 16','Leeds Beckett','Nottingham','24 February 2027');
  bucsAdd(M,'Round 17','Bath','Cardiff','3 March 2027');
  bucsAdd(M,'Round 17','Brunel','Nottingham','3 March 2027');
  bucsAdd(M,'Round 17','Cardiff Met','Leeds Beckett','3 March 2027');
  bucsAdd(M,'Round 17','Hartpury','Durham','3 March 2027');
  bucsAdd(M,'Round 17','Loughborough','Exeter','3 March 2027');
  bucsAdd(M,'Round 18','Loughborough','Bath','10 March 2027');
  bucsAdd(M,'Round 18','Hartpury','Brunel','10 March 2027');
  bucsAdd(M,'Round 18','Cardiff','Durham','10 March 2027');
  bucsAdd(M,'Round 18','Nottingham','Cardiff Met','10 March 2027');
  bucsAdd(M,'Round 18','Exeter','Leeds Beckett','10 March 2027');
  bucsAdd(M,'QF','TBD','TBD','31 March 2027');
  bucsAdd(M,'SF','TBD','TBD','7 April 2027');
  bucsAdd(M,'Final','TBD','TBD','21 April 2027');
})();

const VALID_STATUSES = ['Proposed', 'Approved', 'Rejected', 'Removed'];
const STATUS_KV_KEY = 'statuses';
const OVERRIDES_KV_KEY = 'overrides';
const MANUAL_KV_KEY = 'manualFixtures';
const STATUS_HISTORY_KV_KEY = 'statusHistory';
const STATUS_HISTORY_MAX = 500;
const CLUBBER_SNAPSHOT_KV_KEY = 'clubberSnapshot';
const FIXTURE_CACHE_KV_KEY = 'fixtureCache';

// Same composite key the dashboard uses client-side to match a fixture
// across reloads (county|competition|teamA|teamB|date), so Approve/Reject/
// Remove decisions survive a re-scrape even though fixtures have no stable
// upstream ID. Server-side fixture dates are 'D Month YYYY' strings (e.g.
// "26 June 2026"); this converts to the same YYYY-MM-DD form the client
// produces before computing the key.
const MONTH_TO_NUM = {
  January: '01', February: '02', March: '03', April: '04',
  May: '05', June: '06', July: '07', August: '08',
  September: '09', October: '10', November: '11', December: '12',
};
function toIsoDate(d) {
  const [day, month, year] = d.split(' ');
  return `${year}-${MONTH_TO_NUM[month] || month}-${day.padStart(2, '0')}`;
}
function fixtureKey(f) {
  return `${f.county}|${f.competition}|${f.teamA}|${f.teamB}|${toIsoDate(f.date)}`;
}

async function getStatusMap(kv) {
  if (!kv) return {};
  const raw = await kv.get(STATUS_KV_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function getOverridesMap(kv) {
  if (!kv) return {};
  const raw = await kv.get(OVERRIDES_KV_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function getManualFixtures(kv) {
  if (!kv) return [];
  const raw = await kv.get(MANUAL_KV_KEY);
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

async function getStatusHistory(kv) {
  if (!kv) return [];
  const raw = await kv.get(STATUS_HISTORY_KV_KEY);
  if (!raw) return [];
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
}

function parseDevice(ua) {
  if (!ua) return 'Unknown';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Linux/.test(ua)) return 'Linux';
  return 'Unknown';
}

// Normalise a time string to 24h HH:MM so "2:15 pm" and "14:15" compare equal.
function normaliseTime(t) {
  if (!t) return '';
  const m12 = t.trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2];
    const ap = m12[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  // Already HH:MM or similar — return as-is after trimming
  return t.trim();
}

// Normalise a venue string: lowercase, strip trailing ", County/City" suffix,
// and collapse whitespace — so "Netwatch Cullen Park, Carlow" and
// "Netwatch Cullen Park" compare equal.
function normaliseVenue(v) {
  if (!v) return '';
  return v.trim()
    .replace(/,\s*[^,]+$/, '') // strip last ", something" segment
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

async function getClubberSnapshot(kv) {
  if (!kv) return {};
  const raw = await kv.get(CLUBBER_SNAPSHOT_KV_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

// Sends a change-alert card to a Microsoft Teams incoming webhook.
// webhookUrl comes from the TEAMS_WEBHOOK_URL secret.
async function sendTeamsNotification(webhookUrl, changes) {
  if (!webhookUrl || !changes.length) return;

  const rows = changes.map(c => {
    const diffs = c.diffs.map(d => `**${d.field}**: ~~${d.from}~~ → ${d.to}`).join('\n\n');
    return `### ${c.teamA} v ${c.teamB}\n${c.county} · ${c.competition}${c.date ? ` · ${c.date}` : ''}\n\n${diffs}`;
  }).join('\n\n---\n\n');

  const body = {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        type: 'AdaptiveCard',
        version: '1.4',
        body: [
          {
            type: 'TextBlock',
            text: `⚠️ ${changes.length} Approved fixture${changes.length > 1 ? 's' : ''} changed`,
            weight: 'Bolder',
            size: 'Medium',
          },
          {
            type: 'TextBlock',
            text: rows,
            wrap: true,
          },
        ],
      },
    }],
  };

  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const TRACKED_FIELDS = ['date', 'time', 'venue'];

export default {
  // Cron handler: runs every hour, fetches all fixtures, diffs against the
  // stored snapshot for Approved fixtures, and sends a Teams alert if anything changed.
  async scheduled(event, env, ctx) {
    const kv = env.FIXTURE_STATUS;
    if (!kv) return;

    // Re-use the existing fetch handler to get the full fixtures payload — this
    // keeps the scraping + merging logic in one place with no duplication.
    let payload;
    try {
      const resp = await this.fetch(new Request('https://internal/fixtures'), env);
      payload = await resp.json();
    } catch (e) {
      console.error('Cron: fixture fetch failed', e);
      return;
    }

    const fixtures = payload.fixtures || [];

    const [snapshot, statusMap] = await Promise.all([
      getClubberSnapshot(kv),
      getStatusMap(kv),
    ]);
    const changes = [];
    const newSnapshot = { ...snapshot };

    for (const f of fixtures) {
      const key = fixtureKey(f);
      const status = statusMap[key] || f.status || 'Proposed';
      if (status !== 'Approved') continue;

      // Normalised values used for comparison (strips formatting differences)
      const norm = {
        date: toIsoDate(f.date),
        time: normaliseTime(f.time),
        venue: normaliseVenue(f.venue),
        round: (f.round || '').trim(),
      };
      // Raw values used for display in the Teams card — store time in 24h so display matches comparison
      const raw = { date: toIsoDate(f.date), time: norm.time, venue: f.venue || '', round: f.round || '' };
      const prev = snapshot[key];

      if (prev) {
        // Support old flat snapshot format ({ date, time, venue, round }) transparently
        const prevNorm = prev.norm
          ? prev.norm
          : { date: prev.date, time: normaliseTime(prev.time), venue: normaliseVenue(prev.venue), round: (prev.round||'').trim() };
        const prevRaw = prev.raw || prev;
        const diffs = TRACKED_FIELDS
          .filter(field => prevNorm[field] !== norm[field])
          .map(field => ({ field: field.charAt(0).toUpperCase() + field.slice(1), from: prevRaw[field], to: raw[field] }));
        if (diffs.length) {
          changes.push({ teamA: f.teamA, teamB: f.teamB, county: f.county, competition: f.competition, date: norm.date, diffs });
        }
      }

      newSnapshot[key] = { norm, raw };
    }

    await kv.put(CLUBBER_SNAPSHOT_KV_KEY, JSON.stringify(newSnapshot));

    if (changes.length && env.TEAMS_WEBHOOK_URL) {
      try {
        await sendTeamsNotification(env.TEAMS_WEBHOOK_URL, changes);
      } catch (e) {
        console.error('Cron: Teams notification failed', e);
      }
    }
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const kv = env.FIXTURE_STATUS;

    if (request.method === 'POST') {
      try {
        const body = await request.json();

        // Auth actions (no session required for login/logout/validateSession)
        const authActions = ['login','logout','validateSession','changePassword','adminResetPassword','adminCreateUser'];
        if (authActions.includes(body.action)) {
          if (!kv) return jsonResp({ ok: false, error: 'KV not bound' }, 500);
          const authResp = await handleAuth(body.action, body, kv, request, env.ADMIN_KEY || '');
          if (authResp) return authResp;
        }

        // User prefs (display name) — no auth required, keyed by clientId
        if (body.action === 'getPrefs') {
          if (!kv) return jsonResp({ ok: false, error: 'KV not bound' }, 500);
          const clientId = (body.clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
          if (!clientId) return jsonResp({ ok: false, error: 'clientId required' }, 400);
          const raw = await kv.get('prefs:' + clientId);
          const prefs = raw ? JSON.parse(raw) : {};
          return jsonResp({ ok: true, prefs });
        }
        if (body.action === 'setPrefs') {
          if (!kv) return jsonResp({ ok: false, error: 'KV not bound' }, 500);
          const clientId = (body.clientId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
          if (!clientId) return jsonResp({ ok: false, error: 'clientId required' }, 400);
          const allowed = { displayName: 1 };
          const prefs = {};
          for (const [k, v] of Object.entries(body.prefs || {})) {
            if (allowed[k] && typeof v === 'string') prefs[k] = v.slice(0, 120);
          }
          await kv.put('prefs:' + clientId, JSON.stringify(prefs), { expirationTtl: 60 * 60 * 24 * 365 * 5 }); // 5 years
          return jsonResp({ ok: true });
        }

        // All other POST actions require a valid session
        const authedActions = ['setManualFixtures','setOverrides'];
        if (authedActions.includes(body.action)) {
          if (!kv) return jsonResp({ ok: false, error: 'KV not bound' }, 500);
          const username = await validateSession(kv, request);
          if (!username) return jsonResp({ ok: false, error: 'Not authenticated' }, 401);
        }

        // Manual fixture sync
        if (body.action === 'setManualFixtures') {
          if (!kv) {
            return new Response(
              JSON.stringify({ ok: false, error: 'No FIXTURE_STATUS KV namespace bound' }),
              { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
            );
          }
          const mf = Array.isArray(body.fixtures) ? body.fixtures : [];
          await kv.put(MANUAL_KV_KEY, JSON.stringify(mf));
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
        }

        // Shared-override sync (socials, replay, videographer, clubberCreated, etc.)
        if (body.action === 'setOverrides') {
          const updates = Array.isArray(body.updates) ? body.updates : [];
          if (!kv) {
            return new Response(
              JSON.stringify({ ok: false, error: 'No FIXTURE_STATUS KV namespace bound' }),
              { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
            );
          }
          const overridesMap = await getOverridesMap(kv);
          const clubberUpdates = [];
          for (const { key, fields } of updates) {
            if (key && fields && typeof fields === 'object') {
              const prev = overridesMap[key] || {};
              overridesMap[key] = Object.assign(prev, fields);
              // Track when a fixture is marked as created in Clubber for the first time
              if (fields.clubberCreated && !prev.clubberCreated) {
                clubberUpdates.push(key);
              }
            }
          }
          const saves = [kv.put(OVERRIDES_KV_KEY, JSON.stringify(overridesMap))];
          if (clubberUpdates.length) {
            const history = await getStatusHistory(kv);
            const timestamp = new Date().toISOString();
            const user = typeof body.user === 'string' ? body.user.slice(0, 60) : '';
            const device = parseDevice(request.headers.get('User-Agent') || '');
            for (const key of clubberUpdates) {
              history.push({ key, status: 'Clubber', previousStatus: 'Approved', timestamp, user, device });
            }
            if (history.length > STATUS_HISTORY_MAX) history.splice(0, history.length - STATUS_HISTORY_MAX);
            saves.push(kv.put(STATUS_HISTORY_KV_KEY, JSON.stringify(history)));
          }
          await Promise.all(saves);
          return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
        }

        const keys = Array.isArray(body.keys) ? body.keys : [];
        const status = body.status;
        if (!VALID_STATUSES.includes(status) || keys.length === 0) {
          return new Response(
            JSON.stringify({ ok: false, error: 'Invalid status or empty keys' }),
            { status: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
          );
        }
        if (!kv) {
          return new Response(
            JSON.stringify({ ok: false, error: 'No FIXTURE_STATUS KV namespace bound to this Worker' }),
            { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
          );
        }
        const [statusMap, history] = await Promise.all([getStatusMap(kv), getStatusHistory(kv)]);
        const timestamp = new Date().toISOString();
        const user = typeof body.user === 'string' ? body.user.slice(0, 60) : '';
        const device = parseDevice(request.headers.get('User-Agent') || '');
        for (const key of keys) {
          const previousStatus = statusMap[key] || 'Proposed';
          statusMap[key] = status;
          history.push({ key, status, previousStatus, timestamp, user, device });
        }
        // Keep only the most recent entries
        if (history.length > STATUS_HISTORY_MAX) history.splice(0, history.length - STATUS_HISTORY_MAX);
        await Promise.all([
          kv.put(STATUS_KV_KEY, JSON.stringify(statusMap)),
          kv.put(STATUS_HISTORY_KV_KEY, JSON.stringify(history)),
        ]);
        return new Response(
          JSON.stringify({ ok: true }),
          { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      } catch (err) {
        return new Response(
          JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }),
          { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
        );
      }
    }

    // History endpoint — lightweight, returns only the audit log
    if (url.searchParams.has('history')) {
      try {
        const hist = await getStatusHistory(kv);
        return new Response(JSON.stringify({ ok: true, history: hist.slice().reverse() }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        });
      }
    }

    // Stale-while-revalidate: if KV cache is < 55 min old serve it immediately;
    // start a background live-fetch to keep it warm. Force live fetch with ?refresh=1.
    const forceRefresh = url.searchParams.has('refresh');
    if (!forceRefresh && kv) {
      try {
        const cached = await kv.get(FIXTURE_CACHE_KV_KEY);
        if (cached) {
          const { cachedAt, fixtures: baseFixtures } = JSON.parse(cached);
          const ageMs = Date.now() - new Date(cachedAt).getTime();
          if (ageMs < 55 * 60 * 1000) { // < 55 minutes: serve immediately
            const [statusMap, overridesMap, kvManualFixtures] = await Promise.all([
              getStatusMap(kv), getOverridesMap(kv), getManualFixtures(kv),
            ]);
            const fixtures = baseFixtures
              .map((f) => {
                const key = fixtureKey(f);
                const ov = overridesMap[key];
                return { ...f, ...(ov || {}), status: statusMap[key] || 'Proposed' };
              })
              .filter((f) => f.status !== 'Removed');
            // Background: refresh the cache without blocking this response
            if (ctx) ctx.waitUntil(
              this.fetch(new Request(url.origin + url.pathname + '?refresh=1'), env, ctx).catch(() => {})
            );
            return new Response(
              JSON.stringify({ fetchedAt: cachedAt, fixtures, overrides: overridesMap, manualFixtures: kvManualFixtures }),
              { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
            );
          }
        }
      } catch (_) { /* fall through to live fetch */ }
    }

    try {
      const cacDebug = [];
      const [corkResults, waterfordResults, laoisResults, wexfordResults, kerryResults, offalyResults, tipperaryResults, tipperaryFootballResults, kildareResults, roscommonFootballResults, roscommonHurlingResults, kilkennyResults, monaghanResults, meathResults, longfordResults, carlowLiveResults, louthLiveResults, tipperaryCamogieResults, kilkennyCamogieResults] = await Promise.all([
        Promise.all(CORK_COMPETITIONS.map(fetchCorkCompetition)).catch(() => []),
        Promise.all(WATERFORD_COMPETITIONS.map(fetchWaterfordCompetition)).catch(() => []),
        fetchLaoisCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Laois', 'laoisgaa.ie', c, cacDebug)))).catch(() => []),
        fetchWexfordCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Wexford', 'wexford.clubandcounty.com', c, cacDebug)))).catch(() => []),
        fetchKerryCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Kerry', 'www.kerrygaa.ie', c, cacDebug)))).catch(() => []),
        fetchOffalyCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Offaly', 'offaly.gaa.ie', c, cacDebug)))).catch(() => []),
        fetchTipperaryHurlingCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Tipperary', 'tipperary.gaa.ie', c, cacDebug)))).catch(() => []),
        fetchTipperaryFootball(cacDebug).catch(() => []),
        fetchKildare(cacDebug).catch(() => []),
        fetchRoscommonFootball().catch(() => []),
        fetchRoscommonSport('hurling').catch(() => []),
        fetchKilkennyCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Kilkenny', 'kilkennygaa.ie', c, cacDebug)))).catch(() => []),
        fetchMonaghanCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Monaghan', 'www.monaghangaa.ie', c, cacDebug)))).catch(() => []),
        fetchMeathCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Meath', 'meath.gaa.ie', c, cacDebug)))).catch(() => []),
        fetchLongford(env.FOIREANN_API_KEY).catch(() => []),
        fetchCarlowFixtures().catch(() => []),
        fetchLouthFixtures().catch(() => []),
        fetchTipperaryCamogieFixtures().catch(() => []),
        fetchKilkennyAmogieCompetitions().then(dc => Promise.all(dc.map(c => fetchCacDirectCompetition('Kilkenny', 'kilkennycamogie.ie', c, cacDebug)))).catch(() => []),
      ]);

      const fixCamel = s => s
        .replace(/([a-z])([A-Z])/g, '$1 $2')      // camelCase: e.g. KillarneyLegion → Killarney Legion
        .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2'); // ACRONYM+Word: e.g. GAAGrounds → GAA Grounds
      const fixNames = f => ({ ...f, teamA: fixCamel(f.teamA), teamB: fixCamel(f.teamB), venue: fixCamel(f.venue) });

      let fixtures = [
        ...corkResults.flat().map(f => fixNames({ ...f, teamA: fixCorkName(f.teamA), teamB: fixCorkName(f.teamB), venue: fixCorkName(f.venue) })),
        ...waterfordResults.flat().map(fixNames),
        ...laoisResults.flat().map(fixNames),
        ...wexfordResults.flat().map(fixNames),
        ...kerryResults.flat().map(f => { const g = fixNames({ ...f, teamA: fixKerryName(f.teamA), teamB: fixKerryName(f.teamB), venue: fixKerryName(f.venue) }); return { ...g, teamA: fixKerryName(g.teamA), teamB: fixKerryName(g.teamB), venue: fixKerryName(g.venue) }; }),
        ...offalyResults.flat().map(fixNames),
        ...tipperaryResults.flat().map(fixNames),
        ...tipperaryFootballResults.map(fixNames),
        ...kildareResults.map(fixNames),
        ...roscommonFootballResults.map(fixNames),
        ...roscommonHurlingResults.map(fixNames),
        ...kilkennyResults.flat().map(fixNames),
        ...monaghanResults.flat().map(fixNames),
        ...meathResults.flat().map(fixNames),
        ...(longfordResults.length > 0 ? longfordResults : LONGFORD_FIXTURES),
        ...TIPPERARY_FIXTURES,
        ...KILDARE_FIXTURES,
        ...KERRY_STATIC_FIXTURES,
        ...OFFALY_STATIC_FIXTURES,
        ...(carlowLiveResults.length > 0 ? carlowLiveResults : CARLOW_FIXTURES),
        ...(louthLiveResults.length > 0 ? louthLiveResults : LOUTH_FIXTURES.filter(f => !/^Winner|^Loser/i.test(f.teamA) && !/^Winner|^Loser/i.test(f.teamB))),
        ...tipperaryCamogieResults,
        ...kilkennyCamogieResults.flat().map(f => ({ ...fixNames(f), sport: 'Camogie' })),
        ...RUGBY_FIXTURES,
      ];

      // Global dedup: normalise time case so "7:00 pm" and "7:00 PM" collapse to one record.
      // When two records share the same identity key, keep the richer one (has round > longer venue).
      {
        const globalSeen = new Map();
        for (const f of fixtures) {
          const key = `${f.county}|${f.competition}|${f.teamA}|${f.teamB}|${toIsoDate(f.date)}|${(f.time || '').toLowerCase().trim()}`;
          if (!globalSeen.has(key)) {
            globalSeen.set(key, f);
          } else {
            const existing = globalSeen.get(key);
            // Prefer whichever has a round, then longer venue string
            const existingScore = (existing.round ? 2 : 0) + (existing.venue || '').length;
            const newScore = (f.round ? 2 : 0) + (f.venue || '').length;
            if (newScore > existingScore) globalSeen.set(key, f);
          }
        }
        fixtures = [...globalSeen.values()];
      }

      const fetchedAt = new Date().toISOString();

      // Save base fixtures as last-known-good cache (always await so background refresh works).
      if (kv) {
        await kv.put(FIXTURE_CACHE_KV_KEY, JSON.stringify({ cachedAt: fetchedAt, fixtures }));
      }

      const [statusMap, overridesMap, kvManualFixtures] = await Promise.all([getStatusMap(kv), getOverridesMap(kv), getManualFixtures(kv)]);
      fixtures = fixtures
        .map((f) => {
          const key = fixtureKey(f);
          const ov = overridesMap[key];
          return { ...f, ...(ov || {}), status: statusMap[key] || 'Proposed' };
        })
        .filter((f) => f.status !== 'Removed');

      const includeDebug = url.searchParams.has('debug');

      return new Response(
        JSON.stringify({
          fetchedAt,
          fixtures,
          overrides: overridesMap,
          manualFixtures: kvManualFixtures,
          ...(includeDebug ? { cacDebug } : {}),
        }),
        {
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        }
      );
    } catch (err) {
      // Attempt to serve last-known-good cached fixtures with fresh statuses applied.
      if (kv) {
        try {
          const cached = await kv.get(FIXTURE_CACHE_KV_KEY);
          if (cached) {
            const { cachedAt, fixtures: baseFixtures } = JSON.parse(cached);
            const [statusMap, overridesMap, kvManualFixtures] = await Promise.all([
              getStatusMap(kv), getOverridesMap(kv), getManualFixtures(kv),
            ]);
            const fixtures = baseFixtures
              .map((f) => {
                const key = fixtureKey(f);
                const ov = overridesMap[key];
                return { ...f, ...(ov || {}), status: statusMap[key] || 'Proposed' };
              })
              .filter((f) => f.status !== 'Removed');
            return new Response(
              JSON.stringify({
                fetchedAt: cachedAt,
                fromCache: true,
                fixtures,
                overrides: overridesMap,
                manualFixtures: kvManualFixtures,
              }),
              { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
            );
          }
        } catch (cacheErr) {
          console.error('Cache fallback failed', cacheErr);
        }
      }
      return new Response(
        JSON.stringify({ error: String(err && err.message ? err.message : err) }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
  },
};
