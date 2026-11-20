// GENERATED from index.html by tools/build-clubber-rules.mjs - do not edit.
// The dashboard's own Clubber export rules, copied unchanged so the Clubber
// API works out exactly the same club IDs, grade, price, time and venue.
// Change the rules in index.html, then run: node tools/build-clubber-rules.mjs
/* eslint-disable */

export const CLUBBER_RULES_FUNCTIONS = ["deriveCode","iso","dayName","to12h","from12h","mk","toIsoDate","normaliseCounty","stableKeyOf","applyOverrides","isRugbyFixture","keyOf","stripDiacritics","clubCoreName","normClubName","CLUBBER_GRADES","underageGradePrice","provincialGradePrice","deriveGrade","lookupTeam","fuzzyLookupClub","lookupClubberCompetition","dublinToUtc","MUNSTER_COUNTIES","LEINSTER_COUNTIES","ALL_GAA_COUNTIES","_pendingIdx","competitionTeamIndex","isTeamPending","isTimeMissing","isDateMissing","isResultPending","venueKey","venueKey0","venueVariants","VENUE_HINTS","VENUE_FILLER","venueCore","isSchoolsFixture","venueScope","resolveVenue","buildGamePayload"];

export function createClubberRules(data = {}) {
  let fixtures = data.fixtures || [];
  let manualFixtures = data.manualFixtures || [];
  let fixtureOverrides = data.fixtureOverrides || {};
  let teamMappings = data.teamMappings || {};
  let competitionLookup = data.competitionLookup || {};
  let sportsCountiesIndex = data.sportsCountiesIndex || {};
  let sportsSchoolsIndex = data.sportsSchoolsIndex || {};
  let sportsUniversitiesIndex = data.sportsUniversitiesIndex || {};
  let clubberVenuesIndex = data.clubberVenuesIndex || {};
  let venueMappings = data.venueMappings || {};

  function deriveCode(competition, sport) {
    if (sport) return sport;
    const c = competition.toLowerCase();
    if (c.includes('camogie')) return 'Camogie';
    if (c.includes('hurling') || / hc\b/i.test(competition)) return 'Hurling';
    if (c.includes('football') || / fc\b/i.test(competition)) return 'Football';
    return '';
  }

  function iso(d){ // d = 'D Month YYYY' (an ISO date, e.g. from a dashboard date edit, passes through)
    if(/^\d{4}-\d{2}-\d{2}$/.test(d||'')) return d;
    const months={January:'01',February:'02',March:'03',April:'04',May:'05',June:'06',July:'07',August:'08',September:'09',October:'10',November:'11',December:'12'};
    const [day,month,year]=d.split(' ');
    return `${year}-${months[month]}-${day.padStart(2,'0')}`;
  }

  function dayName(isoDate){
    const days=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    return days[new Date(isoDate+'T00:00:00').getDay()];
  }

  function to12h(t){ // '19:15' -> '7:15 PM'
    if(!/^\d{1,2}:\d{2}$/.test(t)) return t; // e.g. 'TBC'
    let [h,m]=t.split(':').map(Number);
    const ap=h>=12?'PM':'AM';
    h=h%12; if(h===0)h=12;
    return `${h}:${String(m).padStart(2,'0')} ${ap}`;
  }

  function from12h(t){ // '7:15 PM' -> '19:15', '19:00' -> '19:00'
    if(!t) return '';
    const m=t.match(/(\d+):(\d+)\s*(AM|PM)/i);
    if(m) {
      let [,h,min,ap]=m; h=parseInt(h);
      if(ap.toUpperCase()==='PM'&&h!==12) h+=12;
      if(ap.toUpperCase()==='AM'&&h===12) h=0;
      return `${String(h).padStart(2,'0')}:${min}`;
    }
    // Already 24h format (HH:MM) — pass through
    if(/^\d{1,2}:\d{2}$/.test(t.trim())) return t.trim().padStart(5,'0');
    return ''; // TBC or unrecognised
  }

  function mk(county,teamA,teamB,date,time,venue,competition,round){
    const d=iso(date);
    return {county,teamA,teamB,date:d,day:dayName(d),time:to12h(time),venue,competition,round:round||'',status:'Proposed'};
  }

  function toIsoDate(d){
    if(!d) return '';
    if(/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0,10);
    try{ return iso(d); }catch(e){ return d; }
  }

  function normaliseCounty(county){
    if(!county) return county;
    // Strip trailing "LGFA", "Camogie", "GAA" etc. so "Waterford LGFA" → "Waterford"
    return county.replace(/\s+(LGFA|Camogie|GAA)\s*$/i, '').trim();
  }

  function stableKeyOf(f){
    return `${f.county}|${f.teamA}|${f.teamB}|${f.competition}`;
  }

  function applyOverrides(){
    fixtures.forEach(f=>{
      const k=f._origKey||keyOf(f), ov=fixtureOverrides[k];
      if(!ov) return;
      if(ov.county!==undefined) f.county=ov.county;
      if(ov.teamA!==undefined) f.teamA=ov.teamA;
      if(ov.teamB!==undefined) f.teamB=ov.teamB;
      if(ov.date!==undefined){f.date=ov.date;f.day=ov.day||dayName(ov.date);}
      if(ov.time!==undefined) f.time=ov.time;
      if(ov.venue!==undefined) f.venue=ov.venue;
      if(ov.competition!==undefined) f.competition=ov.competition;
      if(ov.round!==undefined) f.round=ov.round;
      if(ov.code!==undefined) f.code=ov.code;
      if(ov.socials!==undefined){f.socials=ov.socials;f.socialsEmail=ov.socialsEmail;}
      if(ov.support2!==undefined){f.support2=ov.support2;f.support2Email=ov.support2Email;}
      if(ov.replay!==undefined){f.replay=ov.replay;}
      if(ov.cameras!==undefined){f.cameras=ov.cameras;}
      if(ov.videographer!==undefined){f.videographer=ov.videographer;f.videographerEmail=ov.videographerEmail;}
      if(ov.unitSystem!==undefined){f.unitSystem=ov.unitSystem;}
      if(ov.unit!==undefined){f.unit=ov.unit;}
      if(ov.clubberCreated!==undefined){f.clubberCreated=ov.clubberCreated;}
      if(ov.clubberGameId!==undefined){f.clubberGameId=ov.clubberGameId;}
      if(ov.clubberVenue!==undefined){f.clubberVenue=ov.clubberVenue;}
      if(ov.teamACounty!==undefined){ if(ov.teamACounty) f.teamACounty=ov.teamACounty; else delete f.teamACounty; }
      if(ov.teamBCounty!==undefined){ if(ov.teamBCounty) f.teamBCounty=ov.teamBCounty; else delete f.teamBCounty; }
      if(ov.clubberPick!==undefined){f.clubberPick=ov.clubberPick;}
      if(ov.hero!==undefined){f.hero=ov.hero;}
    });
  }

  function isRugbyFixture(f){ return f.sport==='Rugby' || f.county==='BUCS' || f.county==='Champ' || f.county==='ACE'; }

  function keyOf(f){
    return `${f.county}|${f.competition}|${f.teamA}|${f.teamB}|${f.date}`;
  }

  function stripDiacritics(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  function clubCoreName(n) {
    return normClubName(String(n || '').replace(/\(\s*[a-z0-9]{1,3}\s*\)/gi, ' '))
      .replace(/\b(gaa|gac|gfc|clg|cumann|club|camogie|hurling|football|and)\b|'/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function normClubName(n) {
    return stripDiacritics(n || '').toLowerCase()
      .replace(/\bst\.?\s*/g, 'saint ')
      .replace(/[''`]/g, "'")
      .replace(/[^a-z0-9' ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  const CLUBBER_GRADES = ['Senior 1', 'Senior 2', 'Intermediate 1', 'Intermediate 2', 'Junior 1', 'Junior 2',
    'Junior other', 'Underage 20/21', 'Minor', 'Underage other', 'Masters', 'Wheelchair Hurling'];

  function underageGradePrice(grade) {
    return /^(Minor|Underage 20\/21)$/i.test(grade || '') ? 14.99 : null;
  }

  function provincialGradePrice(grade) {
    if (/^Senior\b/i.test(grade || '')) return 16.99;
    if (/^(Intermediate|Junior)\b/i.test(grade || '')) return 14.99;
    return null;
  }

  function deriveGrade(county, competition) {
    if (!competition) return '';
    const c = competition;
  
    // Fixed grades for specific competitions (checked first)
    if (/\bO.?Donoghue Cup\b/i.test(c)) return 'Senior 1';                         // Kerry (Dr.) O'Donoghue Cup
    if (/Leinster Club Special Hurling Championship/i.test(c)) return 'Junior 1';
    if (/Wheelchair/i.test(c)) return 'Wheelchair Hurling';
    if (/Masters/i.test(c)) return 'Masters';
    if (/\bU\s?-?2[01](?:[A-D])?\b|Under[\s-]?2[01]\b/i.test(c)) return 'Underage 20/21';
  
    // Senior
    if (/Premier\s+Senior/i.test(c)) return 'Senior 1';
    // Offaly Camogie: Senior A → "Senior A", Senior B → "Senior 2"
    if (county === 'Offaly' && /Camogie/i.test(c)) {
      if (/Senior\s+A\b/i.test(c)) return 'Senior A';
      if (/Senior\s+B\b/i.test(c)) return 'Senior 2';
    }
    if (/Senior\s+[AB]\b/i.test(c)) return 'Senior 2';
    if (/Senior/i.test(c)) return 'Senior 1';
  
    // Intermediate
    if (/Premier\s+Intermediate/i.test(c)) return 'Intermediate 1';
    if (/Intermediate\s+[AB]\b/i.test(c)) return 'Intermediate 2';
    if (/Intermediate/i.test(c)) {
      // Laois/Tipperary/Waterford hurling: plain "Intermediate" = I2 (Premier Intermediate = I1)
      if (['Laois', 'Tipperary', 'Waterford'].includes(county) && /Hurling/i.test(c)) return 'Intermediate 2';
      return 'Intermediate 1';
    }
  
    // Minor (Laois runs its minor grade as U17)
    if (/Minor|\bU-?1[78]\b|Under[\s-]?1[78]\b/i.test(c)) return 'Minor';
  
    // Junior
    if (/Premier\s+Junior/i.test(c)) return 'Junior 1';
    if (/Junior\s+B\b/i.test(c)) return 'Junior 2';
    if (/Junior\s+A\b/i.test(c)) {
      // Counties where Premier Junior = J1 → Junior A is below that = J2
      // Also Meath where plain "Junior" = J1 → Junior A = J2
      if (['Cork', 'Kilkenny', 'Tipperary', 'Meath'].includes(county)) return 'Junior 2';
      return 'Junior 1';
    }
    if (/Junior/i.test(c)) {
      // Kerry: plain "Junior" = J2 (Premier Junior = J1)
      if (county === 'Kerry') return 'Junior 2';
      return 'Junior 1';
    }
  
    return '';
  }

  function lookupTeam(teamName, preferredCounty) {
    const name = teamName.replace(/\s+/g, ' ').trim();
    const normApos = s => (s || '').replace(/[''']/g, "'");
    const officialName = (clubId, county) => {
      const clubs = sportsCountiesIndex[(county || '').toLowerCase()] || [];
      const found = clubs.find(c => c.id === clubId);
      return found ? found.name : null;
    };
    const resolve = (county, val) => {
      if (typeof val === 'object') {
        const official = officialName(val.id, county);
        return { county, clubId: val.id, matchedName: official ?? normApos(val.name) };
      }
      const official = officialName(val, county);
      return { county, clubId: val, matchedName: official ?? normApos(name) };
    };
    // Lookup helper: try exact key, then diacritic-stripped key match
    const findInCounty = (teams, n) => {
      if (teams[n]) return teams[n];
      const stripped = stripDiacritics(n);
      if (stripped !== n) {
        const key = Object.keys(teams).find(k => stripDiacritics(k) === stripped);
        if (key) return teams[key];
      }
      return null;
    };
    // 1. Exact match in teamMappings — preferred county first
    const prefTeams = teamMappings[preferredCounty];
    if (prefTeams) {
      const hit = findInCounty(prefTeams, name);
      if (hit) return resolve(preferredCounty, hit);
    }
    // 2. Fuzzy match in sportsCountiesLookup — county-scoped (higher priority than cross-county teamMappings)
    const result = fuzzyLookupClub(name, preferredCounty);
    if (result) return result;
    // 3. Exact match in teamMappings — all other counties (last resort).
    // Flagged crossCounty: the export won't use it without a mapping, since a
    // same-named club in another county is often a different club
    // (e.g. Offaly "St. Patrick's" -> Tipperary "St. Patricks").
    const baseCounty = c => (c || '').replace(/\s+(LGFA|Ladies|Camogie)$/i, '').toLowerCase();
    for (const [county, teams] of Object.entries(teamMappings)) {
      // Province-wide entries (from the review dialog) only apply to those fixtures
      if (['Leinster', 'Munster', 'Leinster PPS', 'Munster PPS', 'Higher Education'].includes(county)) continue;
      const hit = findInCounty(teams, name);
      if (hit) {
        const r = resolve(county, hit);
        if (baseCounty(county) !== baseCounty(preferredCounty)) r.crossCounty = true;
        return r;
      }
    }
    return null;
  }

  function fuzzyLookupClub(teamName, county) {
    const countyKey = (county || '').toLowerCase();
    const clubs = sportsCountiesIndex[countyKey];
    if (!clubs || clubs.length === 0) return null;
  
    const norm = normClubName(teamName);
    const exact = clubs.filter(c => c.normName === norm);
    if (exact.length === 1) {
      return { county, clubId: exact[0].id, matchedName: exact[0].name, autoMatched: true, exact: true };
    }
    // Partial: norm is contained in club name or vice versa (minimum 5 chars)
    if (norm.length >= 5) {
      const partial = clubs.filter(c => c.normName.includes(norm) || norm.includes(c.normName));
      if (partial.length === 1) {
        return { county, clubId: partial[0].id, matchedName: partial[0].name, autoMatched: true };
      }
    }
    return null;
  }

  function lookupClubberCompetition(countyA, countyB) {
    if (countyA !== countyB) return '';
    const gaa = (competitionLookup.sportsList || []).find(s => s.name === 'GAA');
    if (!gaa) return '';
    const entry = (gaa.competitions || []).find(c => c.preferredCounty === countyA);
    return entry ? entry.name : '';
  }

  function dublinToUtc(dateStr, time24h) {
    const [H, M] = time24h.split(':').map(Number);
    const [y, mo, d] = dateStr.split('-').map(Number);
    // Treat the local time as UTC, then see how far Dublin's clock is ahead of it
    const probe = Date.UTC(y, mo - 1, d, H, M);
    const parts = {};
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Dublin', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(probe)).forEach(x => { parts[x.type] = x.value; });
    const shown = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    const utc = new Date(probe - (shown - probe));
    return {
      date: utc.toISOString().slice(0, 10),
      time: utc.toISOString().slice(11, 16),
    };
  }

  const MUNSTER_COUNTIES = ['Clare','Cork','Kerry','Limerick','Tipperary','Waterford'];

  const LEINSTER_COUNTIES = ['Carlow','Dublin','Kildare','Kilkenny','Laois','Longford','Louth','Meath','Offaly','Westmeath','Wexford','Wicklow'];

  const ALL_GAA_COUNTIES = ['Antrim','Armagh','Carlow','Cavan','Clare','Cork','Derry','Donegal','Down','Dublin','Fermanagh','Galway','Kerry','Kildare','Kilkenny','Laois','Leitrim','Limerick','Longford','Louth','Mayo','Meath','Monaghan','Offaly','Roscommon','Sligo','Tipperary','Tyrone','Waterford','Westmeath','Wexford','Wicklow','London'];

  var _pendingIdx = null, _pendingIdxFor = null; // var: render() can run before this line

  function competitionTeamIndex() {
    const sig = fixtures.length + '|' + (fixtures[0] && fixtures[0].id);
    if (_pendingIdx && _pendingIdxFor === sig) return _pendingIdx;
    const idx = new Map();
    for (const x of fixtures) {
      const k = x.county + '|' + x.competition;
      if (!idx.has(k)) idx.set(k, { teams: new Set(), pairs: new Set() });
      const e = idx.get(k), a = normClubName(x.teamA), b = normClubName(x.teamB);
      e.teams.add(a); e.teams.add(b);
      e.pairs.add(a + ' ' + b); e.pairs.add(b + ' ' + a);
    }
    _pendingIdx = idx; _pendingIdxFor = sig;
    return idx;
  }

  function isTeamPending(t, f) {
    t = (t || '').replace(/\s+/g, ' ').trim();
    if (!t) return true;
    if (/^winner\b|^loser\b|\b(winner|loser)$|semi[\s-]?final|^tb[cd]\b/i.test(t)) return true;
    if (/^(runners?-up|(first|second|third|fourth)-plac(e|ed))\b/i.test(t)) return true;
    if (/\s+or\s+|representatives/i.test(t)) return true;
    if ((f.county === 'Munster' || f.county === 'Leinster')
      && ((t.match(/,/g) || []).length >= 2 || ALL_GAA_COUNTIES.some(c => c.toLowerCase() === t.toLowerCase()))) return true;
    if (t.includes('/')) {
      const e = competitionTeamIndex().get(f.county + '|' + f.competition);
      if (e) {
        const parts = t.split('/').map(normClubName);
        if (e.pairs.has(normClubName(t))) return true;
        if (parts.length === 2 && parts.every(x => x && e.teams.has(x))) return true;
      }
    }
    return false;
  }

  function isTimeMissing(f) {
    const t = String(f.time || '').trim();
    return !t || /^(tbc|tba|tbd|-|—)$/i.test(t) || /^(0?0:00|12:00\s*am)$/i.test(t);
  }

  function isDateMissing(f) {
    return !/^\d{4}-\d{2}-\d{2}$/.test(String(f.date || ''));
  }

  function isResultPending(f) {
    // render() first runs from cached data before later constants (e.g.
    // ALL_GAA_COUNTIES) are initialised - never let the marker break the table
    try { return isTeamPending(f.teamA, f) || isTeamPending(f.teamB, f); }
    catch (_) { return false; }
  }

  function venueKey(s) {
    return stripDiacritics(String(s || '')).toLowerCase()
      .replace(/\b[acdefhknprtvwxy]\d{2}\s?[a-z0-9]{4}\b/g, ' ')   // eircodes
      .replace(/['’`]/g, '')                                   // Patrick's = Patricks
      .replace(/\bst\b\.?\s*/g, 'saint ')
      .replace(/\bmc\s+/g, 'mc')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function venueKey0(s) { return venueKey(s).replace(/ /g, ''); }

  function venueVariants(t) {
    const out = [t, t.replace(/\s*\([^)]*\)\s*/g, ' ').trim(), t.split(',')[0].trim()];
    return [...new Set(out.filter(Boolean))];
  }

  const VENUE_HINTS = {
    'darver': ['Louth', 'Cullen Auto Parts Louth GAA Training Centre'],
    'darver pitch 3': ['Louth', 'Cullen Auto Parts Louth GAA Training Centre'],
    'manguard park pitch 1': ['Kildare', 'Manguard Park, Hawkfield'],
    'manguard park pitch1': ['Kildare', 'Manguard Park, Hawkfield'],
    'manguard park pitch 2': ['Kildare', 'Manguard Park, Hawkfield'],
    'thurles outside pitch': ['Tipperary', 'Outside Field Thurles'],
    'limerick it moylish': ['Limerick', 'TUS Moylish Campus'],
    'limerick it': ['Limerick', 'TUS Moylish Campus'],
    'tus': ['Limerick', 'TUS Moylish Campus'],
    'tipperary camogie grounds': ['Tipperary', 'Tipp Camogie Grounds, The Ragg'],
  };

  const VENUE_FILLER = /\b(gaa|gac|gfc|clg|cumann|club|grounds?|pitch|centre|center|park|pairc|the|co|county|field|sports?|complex|venue|supervalu|super valu)\b/g;

  function venueCore(s) { return venueKey(s).replace(VENUE_FILLER, ' ').replace(/\s+/g, ' ').trim(); }

  function isSchoolsFixture(f) {
    return f.county === 'Leinster PPS' || f.county === 'Munster PPS' || /\bschools?\b/i.test(f.competition || '');
  }

  function venueScope(f) {
    const base = String(f.county || '').replace(/\s+(LGFA|Ladies|Camogie|Schools)$/i, '').replace(/^(North|South|East|West|Mid)\s+/i, '');
    if (/^Munster/.test(f.county)) return { key: f.county, counties: MUNSTER_COUNTIES, home: [f.teamACounty, f.teamBCounty].filter(Boolean) };
    if (/^Leinster/.test(f.county)) return { key: f.county, counties: LEINSTER_COUNTIES, home: [f.teamACounty, f.teamBCounty].filter(Boolean) };
    if (clubberVenuesIndex[base.toLowerCase()] || ['London', 'Britain'].includes(base)) return { key: base, counties: [base], home: [base] };
    return { key: f.county || '', counties: null, home: [] }; // Higher Education etc.: anywhere
  }

  function resolveVenue(f) {
    const text = String(f.venue || '').replace(/\s+/g, ' ').trim();
    const sc = venueScope(f);
    const res = (status, extra) => ({ status, text, scopeKey: sc.key, counties: sc.counties, ...extra });
    if (!text || /^(venue\s+)?(tbc|tba|tbd|n\/?a|-|neutral( venue)?|\w+ venue|neutral \(.*\))$/i.test(text)) return res('none');
    const real = v => !/^(tbc|tba|tbd)$/i.test(v.name);
    const everywhere = Object.values(clubberVenuesIndex).flat().filter(real);
    const pool = sc.counties ? everywhere.filter(v => sc.counties.includes(v.county)) : everywhere;
    // 1. A choice made in the review dialog
    const m = (venueMappings[sc.key] || {})[text];
    if (m) {
      const hit = everywhere.find(v => v.name === m.name && v.county === m.county);
      return hit ? res('ok', { venue: hit, mapped: true }) : res('stale', { venue: m });
    }
    // Prefer the home team's county when a provincial name exists in several
    const narrow = hits => {
      if (hits.length < 2 || !sc.home.length) return hits;
      const h = hits.filter(v => sc.home.includes(v.county));
      return h.length ? h : hits;
    };
    const uniq = hits => [...new Map(hits.map(v => [v.county + '|' + v.name, v])).values()];
    // 2. Same name (ignoring case, accents, punctuation, spacing, "St"/"St."),
    // possibly followed by the town or a note
    const variants = venueVariants(text), keys = variants.map(venueKey0);
    let hits = narrow(uniq(pool.filter(v => v.name === text)));
    for (const k of keys) { if (!hits.length) hits = narrow(uniq(pool.filter(v => venueKey0(v.name) === k))); }
    if (hits.length === 1) return res('ok', { venue: hits[0] });
    if (hits.length > 1) return res('ambiguous', { options: hits });
    const hint = VENUE_HINTS[venueKey(text)];
    const hinted = hint && everywhere.find(v => v.county === hint[0] && v.name === hint[1]);
    if (hinted) return res('suggest', { venue: hinted, options: [hinted] });
    // 3. Same apart from words like GAA / Park / Grounds / Pairc
    const core = venueCore(text);
    const cands = [];
    if (core.length >= 3) {
      cands.push(...pool.filter(v => venueCore(v.name) === core));
      // one name contains the other as whole words ("Clara" ~ "Clara GAA, Kilkenny")
      if (!cands.length && core.length >= 4) {
        const re = s => new RegExp('\\b' + s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
        cands.push(...pool.filter(v => { const c = venueCore(v.name); return c.length >= 4 && (re(c).test(core) || re(core).test(c)); }));
      }
    }
    // 4. Same name in a county outside the fixture's own (neutral venues)
    if (!cands.length && sc.counties) cands.push(...everywhere.filter(v => keys.includes(venueKey0(v.name))));
    const opts = narrow(uniq(cands));
    if (opts.length === 1) return res('suggest', { venue: opts[0], options: opts });
    if (opts.length > 1) return res('ambiguous', { options: opts });
    return res('missing');
  }

  function buildGamePayload(f) {
    const errors = [];
    const warnings = [];
    const unmapped = []; // clubs the review dialog offers to map to a Clubber ID
  
    const normA = (f.teamA || '').replace(/\s+/g, ' ').trim();
    const normB = (f.teamB || '').replace(/\s+/g, ' ').trim();
  
    // Provincial club fixtures. Munster rows carry each team's own county
    // (teamACounty/teamBCounty); Leinster's feed doesn't, so Leinster clubs are
    // looked up across all Leinster counties and accepted only if unambiguous.
    const isProvincial = f.county === 'Munster' || f.county === 'Leinster';
    const isPPS = f.county === 'Leinster PPS' || f.county === 'Munster PPS'; // post-primary schools
    const isSchools = isSchoolsFixture(f); // PPS, or a county schools competition
    const isHE = f.county === 'Higher Education'; // colleges (Clubber universityList)
    const countyA = f.teamACounty || f.county;
    const countyB = f.teamBCounty || f.county;
    // Draws list unconfirmed teams ("X or Y", "Winner of QF1", "Clare
    // representatives", "A, B, C or D", or just a county name like "Carlow")
    // - never export those, or the fuzzy matcher would silently pick a club.
    // County feeds use generic placeholders too ("Winner Semi Final 1", "SF Loser").
    // HE (gaa.ie) uses "Runner-Up Group 1A", "First-Place Group 1B", "Third-Placed ..."
    const unconfirmed = t => isTeamPending(t, f); // see isTeamPending
    [normA, normB].forEach(t => { if (unconfirmed(t)) errors.push(`Team not confirmed yet: "${t}"`); });
    const findTeam = (name, county, side) => {
      // Higher Education: colleges are Clubber universities (never clubs). A
      // 'Higher Education' teamMappings entry ({id, name, county}) first, else
      // a university with exactly the same name, if only one has it.
      if (isHE) {
        const he = teamMappings['Higher Education'] || {};
        const trimmed = name.replace(/\s+/g, ' ').trim(), want = normClubName(trimmed);
        const m = he[trimmed] || he[Object.keys(he).find(k => normClubName(k) === want)];
        if (m && typeof m === 'object' && m.county) return { county: m.county, clubId: m.id, matchedName: m.name || trimmed };
        const same = Object.values(sportsUniversitiesIndex).flat().filter(u => u.normName === want);
        return same.length === 1 ? { county: same[0].county, clubId: same[0].id, matchedName: same[0].name } : null;
      }
      if (isProvincial || isPPS) {
        // Exact name first, then ignoring accents/case/punctuation ("Eire Og" = "Éire Óg")
        const regional = teamMappings[f.county] || {};
        const trimmed = name.replace(/\s+/g, ' ').trim();
        const want = normClubName(trimmed);
        const scoped = regional[trimmed] || regional[Object.keys(regional).find(k => normClubName(k) === want)];
        // The team's GAA club ID (crest) proves its county: a province-wide
        // mapping to a club in another county is for a different club with the
        // same name (e.g. Leinster "Castletown" - Laois v Wexford), so skip it
        const crestCounty = side && f['team' + side + 'CountySource'] === 'crest' ? f['team' + side + 'County'] : '';
        if (scoped && typeof scoped === 'object' && scoped.county && !(crestCounty && scoped.county !== crestCounty)) {
          const official = (sportsCountiesIndex[scoped.county.toLowerCase()] || []).find(c => c.id === scoped.id);
          return { county: scoped.county, clubId: scoped.id, matchedName: official ? official.name : (scoped.name || name) };
        }
      }
      // County proven by the club's crest ID (worker: provenCounty). Only a
      // mapping in that county, or exactly one Clubber club there with the same
      // name, is accepted - never a close match. Otherwise the export dialog asks.
      if (side && f['team' + side + 'CountySource'] === 'crest') {
        const r = lookupTeam(name, county);
        if (r && r.clubId && !r.autoMatched && r.county === county) return r;
        const core = clubCoreName(name);
        const hits = (sportsCountiesIndex[county.toLowerCase()] || []).filter(c => clubCoreName(c.name) === core);
        return hits.length === 1 ? { county, clubId: hits[0].id, matchedName: hits[0].name, crest: true } : null;
      }
      // Schools: only accept a teamMappings entry (filed under the school's own
      // county) - fuzzy matching would pick a club, e.g. "Naas CBS" -> Naas GAA.
      if (isSchools) {
        const provinceCounties = f.county === 'Munster PPS' ? MUNSTER_COUNTIES : isPPS ? LEINSTER_COUNTIES : [county];
        const hits = new Map();
        provinceCounties.forEach(c => {
          const r = lookupTeam(name, c);
          if (r && r.clubId && !r.autoMatched && !r.crossCounty && provinceCounties.includes(r.county)) hits.set(r.clubId, r);
        });
        if (hits.size) return hits.size === 1 ? [...hits.values()][0] : null;
        // No mapping: accept a school from Clubber's schools list with exactly the
        // same name, if only one school in the province has it (never a club)
        const want = normClubName(name);
        const same = provinceCounties.flatMap(c => (sportsSchoolsIndex[c.toLowerCase()] || []).filter(x => x.normName === want));
        return same.length === 1 ? { county: same[0].county, clubId: same[0].id, matchedName: same[0].name } : null;
      }
      // Provincial fixtures with no per-team county (Leinster feed, Munster
      // camogie) search every county in the province
      if (!isProvincial || county !== f.county) return lookupTeam(name, county);
      const provinceCounties = f.county === 'Munster' ? MUNSTER_COUNTIES : LEINSTER_COUNTIES;
      const hits = new Map();
      provinceCounties.forEach(c => {
        const r = lookupTeam(name, c);
        if (r && r.clubId && !r.crossCounty && provinceCounties.includes(r.county)) hits.set(r.clubId, r);
      });
      if (hits.size === 1) return [...hits.values()][0];
      // A teamMappings entry (not auto-matched) beats fuzzy partial matches
      const mapped = [...hits.values()].filter(r => !r.autoMatched);
      if (mapped.length === 1) return mapped[0];
      if (hits.size > 1) return { ambiguous: [...hits.values()].map(r => r.matchedName + ' (' + r.county + ')') };
      return null;
    };
    const resolveTeam = (name, norm, county, label) => {
      if (unconfirmed(norm)) return null; // already reported above
      const r = findTeam(name, county, label);
      if (r && r.crossCounty) {
        unmapped.push({ name: norm, county });
        errors.push(`"${norm}" isn't listed under ${county} in Clubber — only found in ${r.county} ("${r.matchedName}"). Map it below if that's the right club`);
        return null;
      }
      if (r && r.ambiguous) {
        unmapped.push({ name: norm, county });
        errors.push(`"${norm}" matches several ${label === 'A' ? 'home' : 'away'} clubs: ${r.ambiguous.join(', ')} — add it to teamMappings.json under the right county`);
        return null;
      }
      if (!r) {
        unmapped.push({ name: norm, county });
        errors.push(`Club not found for "${norm}" (${county})`);
      }
      else if (r.autoMatched) warnings.push(`"${norm}" auto-matched to "${r.matchedName}" — verify this is correct`);
      return r;
    };
    const teamAResult = resolveTeam(f.teamA, normA, countyA, 'A');
    const teamBResult = resolveTeam(f.teamB, normB, countyB, 'B');
  
    // Validate exported names exactly match Clubber's registered names
    [{ result: teamAResult, label: 'Club' }, { result: teamBResult, label: 'Competitor club' }].forEach(({ result, label }) => {
      if (!result?.clubId) return;
      const clubs = sportsCountiesIndex[(result.county || '').toLowerCase()] || [];
      const official = clubs.find(c => c.id === result.clubId);
      if (official && result.matchedName !== official.name) {
        errors.push(`${label} name '${result.matchedName}' does not match registered club '${official.name}'`);
      }
    });
  
    const isRugby = (f.county === 'Champ' || f.county === 'BUCS' || f.county === 'ACE' || (f.code || '').toLowerCase() === 'rugby');
  
    const grade = isRugby ? '' : isPPS ? 'Senior 1' : (deriveGrade(f.county, f.competition) || (isSchools ? 'Senior 1' : ''));
    if (!isRugby && !grade) errors.push(`grade could not be derived from competition "${f.competition}"`);
    if (!isRugby && !(f.code || '').trim()) errors.push(`Code is missing — set a code (e.g. Football, Hurling, LGFA) before exporting`);
  
    // ACE: girls' competitions contain "Girls"; everything else is the boys' league
    const isAceGirls = f.county === 'ACE' && /girls/i.test(f.competition || '');
    const championsType = f.county === 'BUCS'
      ? (f.competition || 'Men\'s BUCS Super Rugby')
      : f.county === 'ACE'
      ? (isAceGirls ? 'RFU ACE Girls League' : 'RFU ACE Boys League')
      : f.county === 'Munster'
      ? (/^camogie$/i.test((f.code || '').trim()) || /^Munster Camogie\b/i.test(f.competition || '') ? 'Munster Camogie' : 'Munster Club')
      : f.county === 'Leinster'
      ? 'Leinster GAA'
      : isPPS
      ? 'Post Primary'
      : f.county === 'Higher Education'
      ? 'GAA'
      : isRugby
      ? 'Champ Rugby'
      : lookupClubberCompetition(
          teamAResult?.county || f.county,
          teamBResult?.county || f.county
        ) || teamAResult?.county || f.county;
  
    const roundNorm = (f.round || '').trim().toLowerCase();
  
    // Map our internal round labels to Clubber's accepted values.
    // Anything that doesn't map cleanly is left blank (Clubber field is optional).
    function toClubberRound(r) {
      const s = (r || '').trim().toLowerCase();
      if (!s) return '';
      if (/quarter.?final|^\bqf\b|^q\/f$/.test(s)) return 'quarter-finals';
      if (/semi.?final|^\bsf\b|^s\/f$/.test(s)) return 'semi-finals';
      if (/\bfinal\b/.test(s)) return 'final'; // catches Final, Relegation Final, etc.
      const m = s.match(/\bround\s*(\d+)\b/) || s.match(/^r(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        // GAA rounds stop at 5; rugby leagues (BUCS, Champ, ACE) run to Round 20+
        if (n >= 1 && (isRugby || n <= 5)) return `Round ${n}`;
      }
      return ''; // Group Stage, Relegation Round, etc. — leave blank
    }
    const isCamogie = /camogie/i.test([f.competition, f.sport, f.code, f.county].join(' '));
    let price = (f.county === 'BUCS' || f.county === 'ACE') ? 7.99 : isRugby ? 9.99 : 14.99;
    if (!isRugby && !isCamogie) {
      if (/\bfinal\b/.test(roundNorm) && !/semi/.test(roundNorm) && !/quarter/.test(roundNorm)) price = 19.99;
      else if (/semi.?final|^\bsf\b/.test(roundNorm)) price = 16.99;
    }
    // Munster & Leinster club fixtures: priced by grade, whatever the round
    const provincialPrice = isProvincial ? provincialGradePrice(grade) : null;
    if (provincialPrice != null) price = provincialPrice;
    const underagePrice = isRugby ? null : underageGradePrice(grade);
    if (underagePrice != null) price = underagePrice;
    // Post-primary schools games (Munster / Leinster PPS, county schools cups):
    // always 14.99, whatever the grade or round
    if (isSchools && !isRugby) price = 14.99;
    // Camogie: always 14.99, whatever the grade, round or province
    if (isCamogie && !isRugby) price = 14.99;
    // Third-level (Higher Education): always 14.99, whatever the grade or round
    if (isHE && !isRugby) price = 14.99;
  
    const county = isRugby ? 'UK'
      : (isProvincial || isPPS || isHE) ? (teamAResult?.county || countyA)
      : (f.county || '').replace(/ LGFA$/i, '');
  
    const rawTime = f.time ? from12h(f.time) : '';
    // No known time (blank/TBC) -> placeholder 00:01
    const utc = rawTime && rawTime.includes(':') ? dublinToUtc(f.date, rawTime) : null;
    const utcTime = utc ? utc.time : '00:01';
  
    // Venue: only an exact Clubber venue name goes in the file. Anything
    // uncertain is left out and flagged, with a picker in the review dialog.
    const venueRes = isRugby ? null : resolveVenue(f);
    if (venueRes) {
      const t = venueRes.text, v = venueRes.venue;
      const where = venueRes.counties ? venueRes.counties.length > 3 ? f.county : venueRes.counties.join('/') : 'any county';
      if (venueRes.status === 'none') warnings.push(t ? `Venue is "${t}" — exported without one` : 'No venue on this fixture — exported without one');
      else if (venueRes.status === 'suggest') warnings.push(`Venue "${t}" is probably Clubber's "${v.name}" (${v.county}) — confirm it in the Venue column, or it's left out`);
      else if (venueRes.status === 'ambiguous') warnings.push(`Venue "${t}" could be ${venueRes.options.map(o => '"' + o.name + '" (' + o.county + ')').join(' or ')} — choose one in the Venue column, or it's left out`);
      else if (venueRes.status === 'missing') warnings.push(`Venue "${t}" isn't in Clubber (${where}) — left out. Add it to Clubber, or pick it in the Venue column if Clubber has it under another name`);
      else if (venueRes.status === 'stale') warnings.push(`Venue "${v.name}" (${v.county}), chosen earlier for "${t}", is no longer in Clubber — choose again; left out`);
    }
    const venueName = venueRes && venueRes.status === 'ok' ? venueRes.venue.name : '';
  
    const payload = {
      gameScope: (f.county === 'BUCS' || f.county === 'Higher Education') ? 'University' : (f.county === 'ACE' || isSchools) ? 'School' : 'Club',
      date: utc ? utc.date : f.date,
      time: utcTime,
      county,
      club: teamAResult?.matchedName || normA,
      clubId: teamAResult?.clubId || '',
      code: isRugby
        ? (f.competition === "Men's BUCS Super Rugby" ? "Union Men's"
          : f.competition === "Women's BUCS Super Rugby" ? "Union Women's"
          : f.county === 'ACE' ? (isAceGirls ? "Union Women's" : "Union Men's")
          : 'Union')
        : (f.code || ''),
      sportType: isRugby ? 'Rugby' : undefined,
      grade: isRugby ? 'Senior 1' : grade,
      championsType,
      season: 'Season 26',
      round: toClubberRound(f.round),
      title: '',
      ...(venueName ? { venue: venueName } : {}),
      competitorClubName: teamBResult?.matchedName || normB,
      competitorClubId: teamBResult?.clubId || '',
      competitorClubCounty: isRugby ? 'UK' : (teamBResult?.county || ''),
      price,
      hideFromFan: f.county === 'BUCS',
      sendToSpectatr: true,
      sendToMagnifi: false,
      ...(f.clubberPick ? { trendingUpcoming: true } : {}),
      ...(f.hero ? { heroSection: true } : {}),
    };
  
    return { payload, errors, warnings, unmapped, venue: venueRes, teams: { a: teamAResult, b: teamBResult } };
  }

  return {
    buildGamePayload,
    CLUBBER_GRADES,
    mk,
    iso,
    dayName,
    to12h,
    from12h,
    toIsoDate,
    normaliseCounty,
    deriveCode,
    keyOf,
    stableKeyOf,
    isRugbyFixture,
    applyOverrides,
    isTimeMissing,
    isDateMissing,
    isResultPending,
    normClubName,
    // Page-state hooks (the page keeps these in globals)
    setFixtures(list) { fixtures = list; },
    applyOverridesTo(list, overrides) { fixtures = list; fixtureOverrides = overrides || {}; applyOverrides(); return fixtures; },
  };
}
