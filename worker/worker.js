// Cloudflare Worker: scrapes Cork, Waterford, Laois, Wexford, Kerry and
// Offaly GAA fixture pages server-side (avoiding browser CORS restrictions),
// merges in Kildare's and Carlow's manually-transcribed static fixtures, and
// returns normalized JSON for the fixtures dashboard to consume.

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

// Order matters: more specific names must be checked before substrings of
// themselves (e.g. "Premier Intermediate Hurling Championship" contains
// "Intermediate Hurling Championship", so it must come first).
const LAOIS_TARGETS = [
  { match: 'Senior Football Championship', name: 'Senior Football Championship' },
  { match: 'Intermediate Football Championship', name: 'Intermediate Football Championship' },
  { match: 'Senior Hurling Championship', name: 'Senior Hurling Championship' },
  { match: 'Premier Intermediate Hurling Championship', name: 'Premier Intermediate Hurling Championship' },
  { match: 'Intermediate Hurling Championship', name: 'Intermediate Hurling Championship' },
];

// Wexford's fixtures are hosted on the same "ClubAndCounty" platform as
// Laois (clubandcounty.com), just embedded via iframe from wexfordgaa.ie.
// These targets use full sponsor-prefixed names since they're unambiguous
// and don't have the substring-collision risk the short Laois names have.
const WEXFORD_TARGETS = [
  { match: 'Pettitts Supervalue Senior Hurling Championship', name: 'Senior Hurling Championship' },
  { match: 'Courtyard Ferns Intermediate Hurling Championship', name: 'Intermediate Hurling Championship' },
  { match: 'Joyces Expert Wexford Intermediate A Hurling Championship', name: 'Intermediate A Hurling Championship' },
  { match: 'Dominic Smith Expert Electrical Senior Football Championship', name: 'Senior Football Championship' },
  { match: 'Amber Springs and Ashdown Park Hotels Intermediate Football Championship', name: 'Intermediate Football Championship' },
  { match: 'Whizzy Internet Intermediate A Football Championship', name: 'Intermediate A Football Championship' },
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
  while (hasMore && page < 15) {
    const url = `${baseUrl}?ajax=1&feed_type=fixtures&page=${page}&size=50`;
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
      json = JSON.parse(bodyText);
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
      if (buf.home && buf.away) {
        let competition = competitionName;
        // Different counties label sub-groups differently: Kerry uses
        // "Group N", Offaly uses "League Division N".
        const groupMatch = (curComp || '').match(/(?:Group|Division)\s+(\w+)/i);
        if (groupMatch) competition += ` Group ${groupMatch[1]}`;
        const roundMatch = (curComp || '').match(/Round\s+(\d+)/);
        const round = roundMatch ? `Round ${roundMatch[1]}` : '';
        out.push({
          county,
          teamA: buf.home,
          teamB: buf.away,
          date: laoisDateToFull(curDate),
          time: buf.time,
          venue: buf.venue,
          competition,
          round,
        });
      }
      buf = emptyBuf();
    }
  }
}

async function fetchCacDirectCompetition(county, baseDomain, comp, debug) {
  const baseUrl = `https://${baseDomain}${comp.path}`;
  const out = [];
  for (const feedType of ['fixtures', 'results']) {
    const url = `${baseUrl}?ajax=1&feed_type=${feedType}&page=0&size=100&sport=${comp.sport}&level=${comp.level}&grade=${comp.grade}&competition=${comp.uuid}`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: baseUrl },
      });
      if (!res.ok) {
        debug.push({ county, feedType, stage: 'http-error', status: res.status });
        continue;
      }
      const json = await res.json();
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

const KERRY_COMPETITIONS = [
  {
    path: '/fixtures-results/hurling/club/senior/garveys-supervalu-senior-hurling-championship/124fff6c-39d9-4c73-b284-4e93043d3478/',
    uuid: '124fff6c-39d9-4c73-b284-4e93043d3478',
    sport: 'hurling',
    level: 'club',
    grade: 'senior',
    name: 'Senior Hurling Championship',
  },
];

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

// ---- Kildare: static data ----
// Kildare's fixtures aren't published on a scrapable website; they were
// manually transcribed from official Cill Dara CCC fixture-sheet images
// (sourced from SharePoint) and cross-checked between each competition's
// "group view" and "round view" sheets for consistency.
function mkStatic(county, teamA, teamB, date, time, venue, competition, round) {
  return { county, teamA, teamB, date, time, venue, competition, round };
}

const KILDARE_FIXTURES = [];

// Kildare - Intermediate Football Championship Group A
[
 ['Leixlip','Suncroft','8 August 2026','17:00','Conneff Park Clane','Round 1'],
 ['Confey','Straffan','8 August 2026','17:15','Cedral St Conleth\'s','Round 1'],
 ['Confey','Leixlip','22 August 2026','15:30','Conneff Park Clane','Round 2'],
 ['Straffan','Suncroft','23 August 2026','13:30','Manguard Park Pitch 2','Round 2'],
 ['Confey','Suncroft','4 September 2026','20:00','Manguard Park Pitch 1','Round 3'],
 ['Leixlip','Straffan','4 September 2026','20:00','Manguard Park Pitch 2','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group A',r[5])));

// Kildare - Intermediate Football Championship Group B
[
 ['Kilcullen','Monasterevan','8 August 2026','15:30','Cedral St Conleth\'s','Round 1'],
 ['Round Towers','St. Laurence\'s','9 August 2026','15:45','Cedral St Conleth\'s','Round 1'],
 ['Kilcullen','St. Laurence\'s','22 August 2026','17:00','Manguard Park Pitch 2','Round 2'],
 ['Monasterevan','Round Towers','23 August 2026','14:00','Cedral St Conleth\'s','Round 2'],
 ['Kilcullen','Round Towers','5 September 2026','18:00','Raheens GAA','Round 3'],
 ['Monasterevan','St. Laurence\'s','5 September 2026','18:00','Manguard Park Pitch 1','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group B',r[5])));

// Kildare - Intermediate Football Championship Group C
[
 ['Ballyteague','Milltown','7 August 2026','19:45','Cedral St Conleth\'s','Round 1'],
 ['Grangenolvin','Nurney','8 August 2026','17:00','Manguard Park Pitch 1','Round 1'],
 ['Ballyteague','Nurney','22 August 2026','15:30','Manguard Park Pitch 2','Round 2'],
 ['Grangenolvin','Milltown','23 August 2026','18:00','Manguard Park Pitch 1','Round 2'],
 ['Ballyteague','Grangenolvin','6 September 2026','14:00','Kilcullen','Round 3'],
 ['Milltown','Nurney','6 September 2026','14:00','Manguard Park Pitch 2','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group C',r[5])));

// Kildare - Intermediate Football Championship Group D
[
 ['Castledermot','Two Mile House','8 August 2026','18:30','Manguard Park Pitch 1','Round 1'],
 ['Ellistown','Rathangan','9 August 2026','14:00','Cedral St Conleth\'s','Round 1'],
 ['Castledermot','Rathangan','23 August 2026','15:00','Manguard Park Pitch 1','Round 2'],
 ['Ellistown','Two Mile House','23 August 2026','16:30','Manguard Park Pitch 2','Round 2'],
 ['Ellistown','Castledermot','6 September 2026','15:30','St Laurence\'s','Round 3'],
 ['Rathangan','Two Mile House','6 September 2026','15:30','Round Towers GFC','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Intermediate Football Championship Group D',r[5])));

// Kildare - Senior Football Championship Group A
[
 ['Clane','Johnstownbridge','21 August 2026','20:00','Manguard Park Pitch 1','Round 1'],
 ['Allenwood','Celbridge','22 August 2026','17:00','Conneff Park Clane','Round 1'],
 ['Allenwood','Clane','6 September 2026','15:45','Cedral St Conleth\'s','Round 2'],
 ['Celbridge','Johnstownbridge','6 September 2026','17:00','Manguard Park Pitch 1','Round 2'],
 ['Allenwood','Johnstownbridge','18 September 2026','20:00','Manguard Park Pitch 1','Round 3'],
 ['Celbridge','Clane','18 September 2026','20:00','Cedral St Conleth\'s','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group A',r[5])));

// Kildare - Senior Football Championship Group B
[
 ['Carbury','Sarsfields','22 August 2026','14:00','Manguard Park Pitch 1','Round 1'],
 ['Caragh','Maynooth','22 August 2026','15:30','Cedral St Conleth\'s','Round 1'],
 ['Caragh','Sarsfields','4 September 2026','19:45','Cedral St Conleth\'s','Round 2'],
 ['Carbury','Maynooth','5 September 2026','17:15','Cedral St Conleth\'s','Round 2'],
 ['Maynooth','Sarsfields','19 September 2026','15:00','Cedral St Conleth\'s','Round 3'],
 ['Caragh','Carbury','19 September 2026','15:00','Manguard Park Pitch 1','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group B',r[5])));

// Kildare - Senior Football Championship Group C
[
 ['Raheens','Sallins','22 August 2026','17:00','Cedral St Conleth\'s','Round 1'],
 ['Athy','Kilcock','23 August 2026','15:45','Cedral St Conleth\'s','Round 1'],
 ['Athy','Sallins','6 September 2026','14:00','Cedral St Conleth\'s','Round 2'],
 ['Kilcock','Raheens','6 September 2026','15:30','Manguard Park Pitch 1','Round 2'],
 ['Kilcock','Sallins','20 September 2026','17:00','Manguard Park Pitch 1','Round 3'],
 ['Athy','Raheens','20 September 2026','17:00','Cedral St Conleth\'s','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group C',r[5])));

// Kildare - Senior Football Championship Group D
[
 ['Moorefield','Naas','21 August 2026','19:45','Cedral St Conleth\'s','Round 1'],
 ['Clogherinkoe','Eadestown','22 August 2026','18:30','Manguard Park Pitch 1','Round 1'],
 ['Clogherinkoe','Moorefield','5 September 2026','15:00','Manguard Park Pitch 1','Round 2'],
 ['Eadestown','Naas','5 September 2026','15:30','Cedral St Conleth\'s','Round 2'],
 ['Eadestown','Moorefield','19 September 2026','16:45','Cedral St Conleth\'s','Round 3'],
 ['Clogherinkoe','Naas','19 September 2026','16:45','Manguard Park Pitch 1','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Senior Football Championship Group D',r[5])));

// Kildare - Junior Football Championship Group A
[
 ['Robertstown','St Kevin\'s','8 August 2026','15:30','Conneff Park Clane','Round 1'],
 ['Rathcoffey','Rheban','9 August 2026','13:30','Manguard Park Pitch 1','Round 1'],
 ['Rheban','St Kevin\'s','22 August 2026','17:00','Round Towers GFC','Round 2'],
 ['Rathcoffey','Robertstown','23 August 2026','15:30','Conneff Park Clane','Round 2'],
 ['Rathcoffey','St Kevin\'s','5 September 2026','16:30','Conneff Park Clane','Round 3'],
 ['Rheban','Robertstown','5 September 2026','16:30','Manguard Park Pitch 2','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Junior Football Championship Group A',r[5])));

// Kildare - Junior Football Championship Group B
[
 ['Cappagh','Castlemitchell','8 August 2026','15:30','Manguard Park Pitch 1','Round 1'],
 ['Ballykelly','Kildangan','9 August 2026','15:00','Manguard Park Pitch 1','Round 1'],
 ['Ballykelly','Cappagh','23 August 2026','14:00','Conneff Park Clane','Round 2'],
 ['Castlemitchell','Kildangan','23 August 2026','14:00','Kilcullen','Round 2'],
 ['Ballykelly','Castlemitchell','5 September 2026','15:00','Round Towers GFC','Round 3'],
 ['Cappagh','Kildangan','5 September 2026','15:00','Conneff Park Clane','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Junior Football Championship Group B',r[5])));

// Kildare - Junior Football Championship Group C
[
 ['Ardclough','Athgarvan','7 August 2026','20:00','Manguard Park Pitch 1','Round 1'],
 ['Ballymore Eustace','Kill','9 August 2026','16:30','Manguard Park Pitch 1','Round 1'],
 ['Ardclough','Ballymore Eustace','21 August 2026','19:45','Manguard Park Pitch 2','Round 2'],
 ['Athgarvan','Kill','23 August 2026','14:00','Raheens GAA','Round 2'],
 ['Athgarvan','Ballymore Eustace','3 September 2026','20:00','Manguard Park Pitch 1','Round 3'],
 ['Ardclough','Kill','3 September 2026','20:00','Manguard Park Pitch 2','Round 3'],
].forEach(r=>KILDARE_FIXTURES.push(mkStatic('Kildare',r[0],r[1],r[2],r[3],r[4],'Junior Football Championship Group C',r[5])));

// ---- Carlow: static data ----
// Carlow publishes fixtures as PDF "Fixture Report" documents (carlowgaa.ie),
// not as a scrapable HTML page, so these were extracted from the official
// PDFs and transcribed here. BYE rounds (odd team count in the Intermediate
// championship) are omitted since they aren't real fixtures.
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
      const cacDebug = [];
      const [corkResults, waterfordResults, laoisResults, wexfordResults, kerryResults, offalyResults] = await Promise.all([
        Promise.all(CORK_COMPETITIONS.map(fetchCorkCompetition)),
        Promise.all(WATERFORD_COMPETITIONS.map(fetchWaterfordCompetition)),
        fetchCacCounty('Laois', 'https://laoisgaa.ie/fixtures-results/', LAOIS_TARGETS, cacDebug),
        fetchCacCounty('Wexford', 'https://wexford.clubandcounty.com/fixtures-results/', WEXFORD_TARGETS, cacDebug),
        Promise.all(KERRY_COMPETITIONS.map((c) => fetchCacDirectCompetition('Kerry', 'www.kerrygaa.ie', c, cacDebug))),
        Promise.all(OFFALY_COMPETITIONS.map((c) => fetchCacDirectCompetition('Offaly', 'offaly.gaa.ie', c, cacDebug))),
      ]);

      const fixtures = [
        ...corkResults.flat(),
        ...waterfordResults.flat(),
        ...laoisResults,
        ...wexfordResults,
        ...kerryResults.flat(),
        ...offalyResults.flat(),
        ...KILDARE_FIXTURES,
        ...CARLOW_FIXTURES,
      ];

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
