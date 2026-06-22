// Cloudflare Worker: scrapes Cork, Waterford and Laois GAA fixture pages
// server-side (avoiding browser CORS restrictions) and returns normalized
// JSON for the fixtures dashboard to consume.

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
];

const LAOIS_TARGETS = [
  { match: 'Senior Football Championship', name: 'Senior Football Championship' },
  { match: 'Intermediate Football Championship', name: 'Intermediate Football Championship' },
  { match: 'Senior Hurling Championship', name: 'Senior Hurling Championship' },
  { match: 'Intermediate Hurling Championship', name: 'Intermediate Hurling Championship' },
  { match: 'Premier Intermediate Hurling Championship', name: 'Premier Intermediate Hurling Championship' },
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
    .replace(/�/g, ''); // strip stray replacement chars from mojibake
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
    round: r.comment || '',
  }));
}

// ---- Laois parser (different CMS: paginated AJAX feed of fixture cards) ----
const LAOIS_TOKEN_RE =
  /(fix_res_date py-2 text-center mb-0">([^<]*)<)|(competition-name flex-fill text-center p-2">\s*<a[^>]*>([^<]*)<\/a>)|(home_team col text-center text-md-right align-self-center">\s*<a[^>]*>\s*([^<]*?)\s*<\/a>)|(class="time rounded[^"]*">\s*([^<]*?)\s*<\/div>)|(away_team col text-center text-md-left align-self-center">\s*<a[^>]*>\s*([^<]*?)\s*<\/a>)|(<strong>Venue:<\/strong>\s*<a[^>]*>([^<]*)<\/a>)/g;

function classifyLaoisComp(compRaw) {
  if (/Junior/i.test(compRaw)) return null;
  for (const t of LAOIS_TARGETS) {
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

function parseLaoisHtml(html, out) {
  let curDate = null;
  let curComp = null;
  let buf = {};
  const re = new RegExp(LAOIS_TOKEN_RE);
  let m;
  while ((m = re.exec(html))) {
    if (m[2] !== undefined) {
      curDate = m[2].trim();
    } else if (m[4] !== undefined) {
      curComp = decodeEntities(m[4].trim().replace(/\s+/g, ' '));
      buf = {};
    } else if (m[6] !== undefined) {
      buf = { home: decodeEntities(m[6].trim()) };
    } else if (m[8] !== undefined) {
      buf.time = m[8].trim();
    } else if (m[10] !== undefined) {
      buf.away = decodeEntities(m[10].trim());
    } else if (m[12] !== undefined) {
      buf.venue = decodeEntities(m[12].trim());
      const cls = classifyLaoisComp(curComp || '');
      if (cls && buf.home && buf.away) {
        out.push({
          county: 'Laois',
          teamA: buf.home,
          teamB: buf.away,
          date: laoisDateToFull(curDate),
          time: buf.time,
          venue: buf.venue,
          competition: cls.competition,
          round: cls.round,
        });
      }
      buf = {};
    }
  }
}

async function fetchLaois() {
  const out = [];
  let page = 0;
  let hasMore = true;
  const seen = new Set();
  while (hasMore && page < 15) {
    const url = `https://laoisgaa.ie/fixtures-results/?ajax=1&feed_type=fixtures&page=${page}&size=50`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
    if (!res.ok) break;
    const json = await res.json();
    if (!json.ok) break;
    parseLaoisHtml(json.html, out);
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

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    try {
      const [corkResults, waterfordResults, laoisResults] = await Promise.all([
        Promise.all(CORK_COMPETITIONS.map(fetchCorkCompetition)),
        Promise.all(WATERFORD_COMPETITIONS.map(fetchWaterfordCompetition)),
        fetchLaois(),
      ]);

      const fixtures = [
        ...corkResults.flat(),
        ...waterfordResults.flat(),
        ...laoisResults,
      ];

      return new Response(
        JSON.stringify({ fetchedAt: new Date().toISOString(), fixtures }),
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
