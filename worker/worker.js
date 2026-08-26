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
  { id: '215999', name: 'Premier Senior FC' },
  { id: '216000', name: 'Senior A FC' },
];

const WATERFORD_COMPETITIONS = [
  { id: '214352', name: 'Senior HC Group A' },
  { id: '214353', name: 'Senior HC Group B' },
  { id: '214355', name: 'Premier Intermediate HC Group A' },
  { id: '214354', name: 'Premier Intermediate HC Group B' },
  { id: '218650', name: 'Junior A Hurling Championship' },
  { id: '218649', name: 'Junior C Hurling Championship' },
];

const LAOIS_COMPETITIONS = [
  { path: '/fixtures-results/football/club/senior/senior-football-championship/6cca5451-31a9-4b52-b984-7774b4983e2b/', uuid: '6cca5451-31a9-4b52-b984-7774b4983e2b', sport: 'football', level: 'club', grade: 'senior', name: 'Senior Football Championship' },
  { path: '/fixtures-results/football/club/intermediate/intermediate-football-championship/5f030f3c-2cf2-4750-9a1d-9be5a3fb21da/', uuid: '5f030f3c-2cf2-4750-9a1d-9be5a3fb21da', sport: 'football', level: 'club', grade: 'intermediate', name: 'Intermediate Football Championship' },
  { path: '/fixtures-results/hurling/club/senior/senior-hurling-championship/45807eed-e83d-4556-b993-09377bea07bf/', uuid: '45807eed-e83d-4556-b993-09377bea07bf', sport: 'hurling', level: 'club', grade: 'senior', name: 'Senior Hurling Championship' },
  { path: '/fixtures-results/hurling/club/intermediate/premier-intermediate-hurling-championship/927f09db-237e-41a9-b085-183cb42aabdc/', uuid: '927f09db-237e-41a9-b085-183cb42aabdc', sport: 'hurling', level: 'club', grade: 'intermediate', name: 'Premier Intermediate Hurling Championship' },
  { path: '/fixtures-results/hurling/club/intermediate/intermediate-hurling-championship/4636a85b-fd62-48e6-a848-235546e99d42/', uuid: '4636a85b-fd62-48e6-a848-235546e99d42', sport: 'hurling', level: 'club', grade: 'intermediate', name: 'Intermediate Hurling Championship' },
];

const WEXFORD_COMPETITIONS = [
  { path: '/fixtures-results/hurling/club/senior/pettitts-supervalue-senior-hurling-championship/b6c4a297-e08a-4188-9e8d-53c06cfaf50e/', uuid: 'b6c4a297-e08a-4188-9e8d-53c06cfaf50e', sport: 'hurling', level: 'club', grade: 'senior', name: 'Senior Hurling Championship' },
  { path: '/fixtures-results/hurling/club/intermediate/the-courtyard-ferns-intermediate-hurling-championship/c4efa6b0-a7e8-4546-ac7d-068fb7e81294/', uuid: 'c4efa6b0-a7e8-4546-ac7d-068fb7e81294', sport: 'hurling', level: 'club', grade: 'intermediate', name: 'Intermediate Hurling Championship' },
  { path: '/fixtures-results/hurling/club/intermediate/joyces-expert-wexford-intermediate-a-hurling-championship/3aab003e-2e33-4967-9121-4c23f31e6d79/', uuid: '3aab003e-2e33-4967-9121-4c23f31e6d79', sport: 'hurling', level: 'club', grade: 'intermediate', name: 'Intermediate A Hurling Championship' },
  { path: '/fixtures-results/football/club/senior/dominic-smith-expert-electrical-senior-football-championship/892924d0-b2fb-40f8-8244-50324f3822c2/', uuid: '892924d0-b2fb-40f8-8244-50324f3822c2', sport: 'football', level: 'club', grade: 'senior', name: 'Senior Football Championship' },
  { path: '/fixtures-results/football/club/intermediate/amber-springs-and-ashdown-park-hotels-intermediate-football-championship/0d8a8195-b0db-4583-9426-86f5c37d9d5d/', uuid: '0d8a8195-b0db-4583-9426-86f5c37d9d5d', sport: 'football', level: 'club', grade: 'intermediate', name: 'Intermediate Football Championship' },
  { path: '/fixtures-results/football/club/intermediate/whizzy-internet-intermediate-a-football-championship/2e8cc25f-84e5-430a-9a25-435f02e5e459/', uuid: '2e8cc25f-84e5-430a-9a25-435f02e5e459', sport: 'football', level: 'club', grade: 'intermediate', name: 'Intermediate A Football Championship' },
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
    });
  }
  return rows;
}

// Cork league pages don't carry group info per-row; it's only present in the
// standings tables as <h3>Group N</h3> followed by team rows.
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
    round: groupMap[r.home] || '',
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
    round: (r.comment || '').replace(/^Round(\d+)$/i, 'Round $1'),
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
      const roundMatch = compRaw.match(/Round\s+(\d+)/);
      const round = roundMatch ? `Round ${roundMatch[1]}` : '';
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
        const roundMatch = compStr.match(/Round\s+(\d+)/i);
        let round = roundMatch ? `Round ${roundMatch[1]}` : '';
        if (!round) {
          // Fallback: use whatever follows the last " - " separator as the
          // stage label (e.g. "Quarter Final 2", "Semi-Final", "Final").
          const parts = compStr.split(' - ');
          if (parts.length > 1) round = parts[parts.length - 1].trim();
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

const KILKENNY_COMPETITIONS = [
  { path: '/fixtures-results/hurling/club/senior/st-canices-credit-union-senior-hurling-league/bf2fc916-357c-402a-be39-e5c119d1fea9/', uuid: 'bf2fc916-357c-402a-be39-e5c119d1fea9', sport: 'hurling', level: 'club', grade: 'senior', name: 'Senior Hurling League' },
  { path: '/fixtures-results/hurling/club/intermediate/michael-lyng-motors-hyundai-intermediate-league/1518a925-dc42-4ac2-8e0c-686876f0b28c/', uuid: '1518a925-dc42-4ac2-8e0c-686876f0b28c', sport: 'hurling', level: 'club', grade: 'intermediate', name: 'Intermediate Hurling League' },
  { path: '/fixtures-results/hurling/club/junior/jj-kavanagh-premier-jnr-league/f0ffc6b6-6e0b-4a16-b7a8-9de4766b2af6/', uuid: 'f0ffc6b6-6e0b-4a16-b7a8-9de4766b2af6', sport: 'hurling', level: 'club', grade: 'junior', name: 'Premier Junior Hurling League' },
];

const KILKENNY_CAMOGIE_COMPETITIONS = [
  { path: '/fixtures-results/camogie/club/senior/michael-lyng-motors-senior-camogie-championship/72901512-0136-4202-8b3b-911ccd35355f/', uuid: '72901512-0136-4202-8b3b-911ccd35355f', sport: 'camogie', level: 'club', grade: 'senior', name: 'Senior Camogie Championship' },
  { path: '/fixtures-results/camogie/club/intermediate/abbott-intermediate-camogie-championship/74fef4e1-9926-4d5d-8538-4cefeaf0fc1f/', uuid: '74fef4e1-9926-4d5d-8538-4cefeaf0fc1f', sport: 'camogie', level: 'club', grade: 'intermediate', name: 'Intermediate Camogie Championship' },
];

const MONAGHAN_COMPETITIONS = [
  {
    path: '/fixtures-results/football/club/senior/senior-football-championship/5d0d90fc-8f40-4280-817b-7a5d71b6d62a/',
    uuid: '5d0d90fc-8f40-4280-817b-7a5d71b6d62a',
    sport: 'football',
    level: 'club',
    grade: 'senior',
    name: 'Senior Football Championship',
  },
  { path: '/fixtures-results/football/club/senior/senior-football-league/9f2a204f-20cd-4cec-852b-2760b4216812/', uuid: '9f2a204f-20cd-4cec-852b-2760b4216812', sport: 'football', level: 'club', grade: 'senior', name: 'Senior Football League' },
  {
    path: '/fixtures-results/football/club/intermediate/intermediate-football-championship/1b9079d3-c2aa-4c06-9479-17b8fbbd93a3/',
    uuid: '1b9079d3-c2aa-4c06-9479-17b8fbbd93a3',
    sport: 'football',
    level: 'club',
    grade: 'intermediate',
    name: 'Intermediate Football Championship',
  },
  {
    path: '/fixtures-results/football/club/junior/junior-football-championship/b5a5d354-a19b-482b-8826-119499a17114/',
    uuid: 'b5a5d354-a19b-482b-8826-119499a17114',
    sport: 'football',
    level: 'club',
    grade: 'junior',
    name: 'Junior Football Championship',
  },
  {
    path: '/fixtures-results/hurling/club/senior/senior-hurling-championship/de727338-5845-4233-8236-beffed1b5160/',
    uuid: 'de727338-5845-4233-8236-beffed1b5160',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'Senior Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/senior/senior-hurling-league-2026/0f17c081-8272-4ace-9829-e212c19f1c6b/',
    uuid: '0f17c081-8272-4ace-9829-e212c19f1c6b',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'Senior Hurling League',
  },
];

const MEATH_COMPETITIONS = [
  { path: '/fixtures-results/hurling/club/senior/2026-shc-ted-murtagh-clothing-footwear-trim/ede1b15c-2b0f-40d4-b69f-0125767718f8/', uuid: 'ede1b15c-2b0f-40d4-b69f-0125767718f8', sport: 'hurling', level: 'club', grade: 'senior', name: 'Senior Hurling Championship' },
  { path: '/fixtures-results/hurling/club/intermediate/2026-ihc-abbey-pharmacy/7a4e5912-efee-486f-b4de-b69563253d31/', uuid: '7a4e5912-efee-486f-b4de-b69563253d31', sport: 'hurling', level: 'club', grade: 'intermediate', name: 'Intermediate Hurling Championship' },
  { path: '/fixtures-results/hurling/club/intermediate/2026-ihc-b-abbey-pharmacy/63320d74-f53a-456f-a21d-331965580e49/', uuid: '63320d74-f53a-456f-a21d-331965580e49', sport: 'hurling', level: 'club', grade: 'intermediate', name: 'Intermediate Hurling Championship B' },
  { path: '/fixtures-results/football/club/senior/2026-sfc-gr-a-fairyhouse-steel/6d1e3b7a-13f7-40b3-9538-43c568d94770/', uuid: '6d1e3b7a-13f7-40b3-9538-43c568d94770', sport: 'football', level: 'club', grade: 'senior', name: 'Senior Football Championship' },
  { path: '/fixtures-results/football/club/senior/2026-sfc-gr-b-fairyhouse-steel/6559156e-a91e-418e-8db5-d4261f3d06a2/', uuid: '6559156e-a91e-418e-8db5-d4261f3d06a2', sport: 'football', level: 'club', grade: 'senior', name: 'Senior Football Championship' },
  { path: '/fixtures-results/football/club/senior/2026-sfc-gr-c-fairyhouse-steel/11d7a6ba-9d24-4451-ab0b-6429430b3c77/', uuid: '11d7a6ba-9d24-4451-ab0b-6429430b3c77', sport: 'football', level: 'club', grade: 'senior', name: 'Senior Football Championship' },
  { path: '/fixtures-results/football/club/senior/2026-sfc-gr-d-fairyhouse-steel/72b01516-aacf-4474-9f80-743cf35f58f5/', uuid: '72b01516-aacf-4474-9f80-743cf35f58f5', sport: 'football', level: 'club', grade: 'senior', name: 'Senior Football Championship' },
  { path: '/fixtures-results/football/club/intermediate/2026-iacfc-meath-cleaning-supplies/699b7e0f-a44c-4c4b-b76c-551a1b002c13/', uuid: '699b7e0f-a44c-4c4b-b76c-551a1b002c13', sport: 'football', level: 'club', grade: 'intermediate', name: 'Intermediate A Football Championship' },
  { path: '/fixtures-results/football/club/intermediate/2026-ifc-gr-a-meade-farm/ab5bfe87-ec32-481b-b082-704908036527/', uuid: 'ab5bfe87-ec32-481b-b082-704908036527', sport: 'football', level: 'club', grade: 'intermediate', name: 'Intermediate Football Championship' },
  { path: '/fixtures-results/football/club/intermediate/2026-ifc-gr-b-meade-farm/f395ac08-91fe-4c4f-ba54-940187674cb7/', uuid: 'f395ac08-91fe-4c4f-ba54-940187674cb7', sport: 'football', level: 'club', grade: 'intermediate', name: 'Intermediate Football Championship' },
  { path: '/fixtures-results/football/club/intermediate/2026-ifc-gr-c-meade-farm/ec52c8c0-58e7-4d73-9b0d-7e66247e21ce/', uuid: 'ec52c8c0-58e7-4d73-9b0d-7e66247e21ce', sport: 'football', level: 'club', grade: 'intermediate', name: 'Intermediate Football Championship' },
  { path: '/fixtures-results/football/club/intermediate/2026-ifc-gr-d-meade-farm/78bce439-10c8-4e7b-958f-58839f72a93f/', uuid: '78bce439-10c8-4e7b-958f-58839f72a93f', sport: 'football', level: 'club', grade: 'intermediate', name: 'Intermediate Football Championship' },
];

const KERRY_COMPETITIONS = [
  {
    path: '/fixtures-results/hurling/club/senior/garveys-supervalu-senior-hurling-championship/124fff6c-39d9-4c73-b284-4e93043d3478/',
    uuid: '124fff6c-39d9-4c73-b284-4e93043d3478',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'Senior Hurling Championship',
  },
  {
    path: '/fixtures-results/football/club/senior/kerry-petroleum-senior-football-club-championship/f4820e52-a11e-4085-baef-108c5d4d242f/',
    uuid: 'f4820e52-a11e-4085-baef-108c5d4d242f',
    sport: 'football',
    level: 'club',
    grade: 'senior',
    name: 'Senior Football Championship',
  },
  {
    path: '/fixtures-results/football/club/intermediate/kerry-petroleum-intermediate-football-club-championship/5016bcb8-80fa-483a-9a28-5a734797ef03/',
    uuid: '5016bcb8-80fa-483a-9a28-5a734797ef03',
    sport: 'football',
    level: 'club',
    grade: 'intermediate',
    name: 'Intermediate Football Championship',
  },
  {
    path: '/fixtures-results/football/club/junior/kerry-petroleum-premier-junior-football-club-championship/f85fed08-f780-408c-824e-d12cd3d9aeb9/',
    uuid: 'f85fed08-f780-408c-824e-d12cd3d9aeb9',
    sport: 'football',
    level: 'club',
    grade: 'junior',
    name: 'Premier Junior Football Championship',
  },
  {
    path: '/fixtures-results/football/club/junior/kerry-petroleum-junior-football-club-championship/d03c65a4-fd20-4f75-b996-40d7f318b275/',
    uuid: 'd03c65a4-fd20-4f75-b996-40d7f318b275',
    sport: 'football',
    level: 'club',
    grade: 'junior',
    name: 'Junior Football Championship',
  },
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

const OFFALY_COMPETITIONS = [
  {
    path: '/fixtures-results/hurling/club/senior/2026-senior-hurling-championship/7441793c-f051-4489-8efb-cd7e41617f74/',
    uuid: '7441793c-f051-4489-8efb-cd7e41617f74',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'Senior Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/senior/2026-senior-b-hurling-championship/c9ba5708-a15e-4a1e-98da-32f0af567fc0/',
    uuid: 'c9ba5708-a15e-4a1e-98da-32f0af567fc0',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'Senior B Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/intermediate/2026-intermediate-hurling-championship/beab9c19-3849-4221-bf48-cdf0fe8b609b/',
    uuid: 'beab9c19-3849-4221-bf48-cdf0fe8b609b',
    sport: 'hurling',
    level: 'club',
    grade: 'intermediate',
    name: 'Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/football/club/senior/2026-senior-football-championship/b4e6f100-d62e-4fb1-9a81-3131563be7f2/',
    uuid: 'b4e6f100-d62e-4fb1-9a81-3131563be7f2',
    sport: 'football',
    level: 'club',
    grade: 'senior',
    name: 'Senior Football Championship',
  },
  {
    path: '/fixtures-results/football/club/senior/2026-senior-b-football-championship/b0eaefd7-a6d0-4c86-a124-50b05a6c6c2d/',
    uuid: 'b0eaefd7-a6d0-4c86-a124-50b05a6c6c2d',
    sport: 'football',
    level: 'club',
    grade: 'senior',
    name: 'Senior B Football Championship',
  },
  {
    path: '/fixtures-results/football/club/intermediate/2026-intermediate-football-championship/5aeb35ee-d903-4133-b9ca-9fbf02e22972/',
    uuid: '5aeb35ee-d903-4133-b9ca-9fbf02e22972',
    sport: 'football',
    level: 'club',
    grade: 'intermediate',
    name: 'Intermediate Football Championship',
  },
];

const TIPPERARY_COMPETITIONS = [
  {
    path: '/fixtures-results/hurling/club/senior/fbd-insurance-county-tipperary-senior-hurling-championship-dan-breen-cup/1f70265b-652f-43e4-a23e-fa36a3a23f7f/',
    uuid: '1f70265b-652f-43e4-a23e-fa36a3a23f7f',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'Tipperary Senior Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/intermediate/fbd-insurance-county-tipperary-intermediate-hurling-championship-michael-maher-cup/a23baf2f-0e3c-4947-98f1-4411ebda06c8/',
    uuid: 'a23baf2f-0e3c-4947-98f1-4411ebda06c8',
    sport: 'hurling',
    level: 'club',
    grade: 'intermediate',
    name: 'Tipperary Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/intermediate/fbd-insurance-county-tipperary-premier-intermediate-hurling-championship-seamus-o-riain-cup/06b306f8-f68a-4099-9dbc-0e38b6f7ed55/',
    uuid: '06b306f8-f68a-4099-9dbc-0e38b6f7ed55',
    sport: 'hurling',
    level: 'club',
    grade: 'intermediate',
    name: 'Tipperary Premier Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/intermediate/doran-oil-mid-premier-intermediate-hurling-championship/dd2a713f-6a9f-4915-8712-82f9dd86043b/',
    uuid: 'dd2a713f-6a9f-4915-8712-82f9dd86043b',
    sport: 'hurling',
    level: 'club',
    grade: 'intermediate',
    name: 'Mid Tipperary Premier Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/intermediate/roadstone-mid-intermediate-hurling-championship/7904e415-bf9e-45ab-9ca3-ae2f3416bfd1/',
    uuid: '7904e415-bf9e-45ab-9ca3-ae2f3416bfd1',
    sport: 'hurling',
    level: 'club',
    grade: 'intermediate',
    name: 'Mid Tipperary Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/senior/cm-signs-cahill-cup/3aa03c3c-b46c-4a58-ba4e-bf77cf80a114/',
    uuid: '3aa03c3c-b46c-4a58-ba4e-bf77cf80a114',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'Mid Tipperary Cahill Cup',
  },
  {
    path: '/fixtures-results/hurling/club/senior/buckley-car-sales-prem-inter-hurling/fd42b45a-9af6-43f7-87c7-3c2df798aaab/',
    uuid: 'fd42b45a-9af6-43f7-87c7-3c2df798aaab',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'North Tipperary Premier Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/senior/jim-mcloughney-menswear-intermediate-hurling/22baeb6c-1093-4003-95b3-c9ff0894126a/',
    uuid: '22baeb6c-1093-4003-95b3-c9ff0894126a',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'North Tipperary Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/intermediate/south-tipperary-intermediate-hurling-championship/1bbeae2e-2cb0-486c-b588-678b426335bf/',
    uuid: '1bbeae2e-2cb0-486c-b588-678b426335bf',
    sport: 'hurling',
    level: 'club',
    grade: 'intermediate',
    name: 'South Tipperary Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/intermediate/west-tipperary-premier-intermediate-hurling-championship/d506ec46-01af-4113-88d2-6114dc7b8969/',
    uuid: 'd506ec46-01af-4113-88d2-6114dc7b8969',
    sport: 'hurling',
    level: 'club',
    grade: 'intermediate',
    name: 'West Tipperary Premier Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/intermediate/west-tipperary-intermediate-hurling-championship-2026/f39d79ac-ac77-41f1-886c-0061a660dd8a/',
    uuid: 'f39d79ac-ac77-41f1-886c-0061a660dd8a',
    sport: 'hurling',
    level: 'club',
    grade: 'intermediate',
    name: 'West Tipperary Intermediate Hurling Championship',
  },
  {
    path: '/fixtures-results/hurling/club/senior/crosco-cup-hurling/b7493f36-1d05-459d-80ec-45f3366b5fc2/',
    uuid: 'b7493f36-1d05-459d-80ec-45f3366b5fc2',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'West Tipperary Crosco Cup',
  },
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
// Returns null for non-championship competitions (underage etc.) which are skipped.
function roscommonFootballCompName(raw) {
  if (/Junior A Football Championship/i.test(raw)) return 'Junior A Football Championship';
  if (/Intermediate Football Championship/i.test(raw)) return 'Intermediate Football Championship';
  if (/Senior Football Championship/i.test(raw)) return 'Senior Football Championship';
  return null;
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
    { pattern: /junior [''‘’]?a[''‘’]? football championship/i, name: "Junior 'A' Football Championship" },
    { pattern: /junior [''‘’]?b[''‘’]? (football )?championship/i, name: "Junior 'B' Football Championship" },
    { pattern: /junior [''‘’]?c[''‘’]? (football )?championship/i, name: "Junior 'C' Football Championship" },
  ];
  try {
    const res = await fetch('https://carlowgaa.ie/fixtures/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }
    });
    if (!res.ok) return [];
    const html = await res.text();
    // Strip tags and split into lines
    const text = html.replace(/<[^>]+>/g, '\n').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#[0-9]+;/g, '');
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const fixtures = [];
    for (let i = 0; i < lines.length; i++) {
      const comp = TARGET_COMPS.find(c => c.pattern.test(lines[i]));
      if (!comp) continue;
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
      // Derive round from context — scan back for a round hint or leave blank
      // (carlowgaa.ie doesn't show round in the listing)
      fixtures.push(mkStatic('Carlow', vsMatch[1].trim(), vsMatch[2].trim(), date, timePart, venue, comp.name, ''));
    }
    return fixtures;
  } catch (e) {
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

// Carlow - Intermediate Football Championship QFs (source: carlowgaa.ie Aug 2026)
[
  ['Eire Og','Tinryland','25 August 2026','19:00','Netwatch Cullen Park','QF'],
  ['Ballinabranna','Clonmore','26 August 2026','19:00','Netwatch Cullen Park','QF'],
  ['Kildavin/Clonegal','Ballon','27 August 2026','19:30','Netwatch Cullen Park','QF'],
  ['Fighting Cocks','St Patricks','27 August 2026','20:15','Fr Ryan Park','QF'],
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

// Carlow - Junior Hurling Championship (source: carlowgaa.ie Sep 2026)
[
  ['Naomh Eoin','Burren Rangers','4 September 2026','19:00','Netwatch Cullen Park','QF'],
  ['Carlow Town Hurling Club','Ballinkillen','4 September 2026','19:00','Netwatch Cullen Park','QF'],
  ['Naomh Brid GAA','Setanta Ceatharlach','4 September 2026','19:30','Netwatch Cullen Park','QF'],
  ['Naomh Moling','Mt Leinster Rangers','4 September 2026','20:30','Netwatch Cullen Park','QF'],
].forEach(r=>CARLOW_FIXTURES.push(mkStatic('Carlow',r[0],r[1],r[2],r[3],r[4],'Junior Hurling Championship',r[5])));

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
// Scrapes louthgaa.ie/fixtures-results/?countyBoardID=20&fixturesOnly=Y&daysAfter=21
// for Senior Championship (Football), Intermediate Championship (Football), Senior Hurling.
// Falls back to empty array if the fetch fails.
async function fetchLouthFixtures() {
  const TARGET_COMPS = [
    { pattern: /anchor tours senior championship/i, name: 'Senior Football Championship', code: 'Football' },
    { pattern: /cti.*intermediate championship|intermediate championship/i, name: 'Intermediate Football Championship', code: 'Football' },
    { pattern: /dkit.*junior championship|junior championship/i, name: 'Junior Football Championship', code: 'Football' },
    { pattern: /senior hurling/i, name: 'Senior Hurling Championship', code: 'Hurling' },
  ];
  try {
    const res = await fetch(
      'https://louthgaa.ie/fixtures-results/?countyBoardID=20&fixturesOnly=Y&daysAfter=21',
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
          const compMatch = TARGET_COMPS.find(c => c.pattern.test(compText));
          currentComp = compMatch || null; // reset to null if not a tracked comp
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
          const f = mkStatic('Louth', teamA, teamB, currentDate, time24, venue, currentComp.name, round);
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
  'Access-Control-Allow-Headers': 'Content-Type',
};

const VALID_STATUSES = ['Proposed', 'Approved', 'Rejected', 'Removed'];
const STATUS_KV_KEY = 'statuses';

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
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const kv = env.FIXTURE_STATUS;

    if (request.method === 'POST') {
      try {
        const body = await request.json();
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
        const statusMap = await getStatusMap(kv);
        for (const key of keys) statusMap[key] = status;
        await kv.put(STATUS_KV_KEY, JSON.stringify(statusMap));
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

    try {
      const cacDebug = [];
      const [corkResults, waterfordResults, laoisResults, wexfordResults, kerryResults, offalyResults, tipperaryResults, tipperaryFootballResults, kildareResults, roscommonFootballResults, roscommonHurlingResults, kilkennyResults, monaghanResults, meathResults, longfordResults, carlowLiveResults, louthLiveResults, tipperaryCamogieResults, kilkennyCamogieResults] = await Promise.all([
        Promise.all(CORK_COMPETITIONS.map(fetchCorkCompetition)),
        Promise.all(WATERFORD_COMPETITIONS.map(fetchWaterfordCompetition)),
        Promise.all(LAOIS_COMPETITIONS.map((c) => fetchCacDirectCompetition('Laois', 'laoisgaa.ie', c, cacDebug))),
        Promise.all(WEXFORD_COMPETITIONS.map((c) => fetchCacDirectCompetition('Wexford', 'wexford.clubandcounty.com', c, cacDebug))),
        Promise.all(KERRY_COMPETITIONS.map((c) => fetchCacDirectCompetition('Kerry', 'www.kerrygaa.ie', c, cacDebug))),
        Promise.all(OFFALY_COMPETITIONS.map((c) => fetchCacDirectCompetition('Offaly', 'offaly.gaa.ie', c, cacDebug))),
        Promise.all(TIPPERARY_COMPETITIONS.map((c) => fetchCacDirectCompetition('Tipperary', 'tipperary.gaa.ie', c, cacDebug))),
        fetchTipperaryFootball(cacDebug),
        fetchKildare(cacDebug),
        fetchRoscommonFootball(),
        fetchRoscommonSport('hurling'),
        Promise.all(KILKENNY_COMPETITIONS.map((c) => fetchCacDirectCompetition('Kilkenny', 'kilkennygaa.ie', c, cacDebug))),
        Promise.all(MONAGHAN_COMPETITIONS.map((c) => fetchCacDirectCompetition('Monaghan', 'www.monaghangaa.ie', c, cacDebug))),
        Promise.all(MEATH_COMPETITIONS.map((c) => fetchCacDirectCompetition('Meath', 'meath.gaa.ie', c, cacDebug))),
        fetchLongford(env.FOIREANN_API_KEY),
        fetchCarlowFixtures(),
        fetchLouthFixtures(),
        fetchTipperaryCamogieFixtures(),
        Promise.all(KILKENNY_CAMOGIE_COMPETITIONS.map((c) => fetchCacDirectCompetition('Kilkenny', 'kilkennycamogie.ie', c, cacDebug))),
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
        ...longfordResults,
        ...LONGFORD_FIXTURES,
        ...TIPPERARY_FIXTURES,
        ...KILDARE_FIXTURES,
        ...carlowLiveResults,
        ...CARLOW_FIXTURES,
        ...(louthLiveResults.length > 0 ? louthLiveResults : LOUTH_FIXTURES.filter(f => !/^Winner|^Loser/i.test(f.teamA) && !/^Winner|^Loser/i.test(f.teamB))),
        ...tipperaryCamogieResults,
        ...kilkennyCamogieResults.flat().map(f => ({ ...fixNames(f), sport: 'Camogie' })),
      ];

      const statusMap = await getStatusMap(kv);
      fixtures = fixtures
        .map((f) => ({ ...f, status: statusMap[fixtureKey(f)] || 'Proposed' }))
        .filter((f) => f.status !== 'Removed');

      const url = new URL(request.url);
      const includeDebug = url.searchParams.has('debug');

      return new Response(
        JSON.stringify({
          fetchedAt: new Date().toISOString(),
          fixtures,
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
      return new Response(
        JSON.stringify({ error: String(err && err.message ? err.message : err) }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
      );
    }
  },
};
