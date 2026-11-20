// Generates worker/clubber-rules.js from index.html.
//
// The Clubber API (worker) must work out exactly the same Clubber fields as
// the dashboard's "Review before export" (club IDs, grade, price, UTC time,
// venue...). Rather than keeping a hand-written second copy of those rules,
// this script copies the dashboard's own functions, unchanged, into a module
// the worker imports. index.html stays the single source of truth.
//
// Run after changing any of those rules in index.html, then redeploy:
//   node tools/build-clubber-rules.mjs
// `node tools/build-clubber-rules.mjs --check` fails if the module is stale.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'index.html');
const outPath = path.join(root, 'worker', 'clubber-rules.js');

// Functions the API needs (their dependencies are found automatically)
const ROOTS = [
  'buildGamePayload', 'CLUBBER_GRADES',
  'mk', 'iso', 'dayName', 'to12h', 'from12h', 'toIsoDate', 'normaliseCounty', 'deriveCode',
  'keyOf', 'stableKeyOf', 'isRugbyFixture', 'applyOverrides',
  'isTimeMissing', 'isDateMissing', 'isResultPending', 'normClubName',
];
// Page state the rules read. Declared by the generated module and filled from
// the worker's data instead of being copied (in the page they are filled by
// fetches / localStorage).
const STATE = {
  fixtures: '[]', manualFixtures: '[]', fixtureOverrides: '{}',
  teamMappings: '{}', competitionLookup: '{}', sportsCountiesIndex: '{}', sportsSchoolsIndex: '{}',
  sportsUniversitiesIndex: '{}', clubberVenuesIndex: '{}', venueMappings: '{}',
};

const html = fs.readFileSync(htmlPath, 'utf8').replace(/\r\n/g, '\n');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

// Top-level declarations: a line starting at column 0 with function/const/
// let/var, running until the next line that starts at column 0 with
// anything but a closing bracket
const chunks = new Map();
let order = 0;
scripts.forEach(src => {
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/);
    if (!m) continue;
    let j = i + 1;
    while (j < lines.length && !/^[^\s}\)\]]/.test(lines[j])) j++;
    const name = m[1] || m[2];
    if (!chunks.has(name)) chunks.set(name, { name, body: lines.slice(i, j).join('\n').replace(/\s+$/, ''), order: order++ });
  }
});

const strip = b => b.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
const names = [...chunks.keys()];
const uses = (body, name) => new RegExp('(?<![\\w$.])' + name.replace(/\$/g, '\\$') + '(?![\\w$])').test(body);
const needed = new Set();
const queue = [...ROOTS];
while (queue.length) {
  const n = queue.pop();
  if (needed.has(n) || STATE[n] !== undefined) continue;
  const c = chunks.get(n);
  if (!c) throw new Error(`"${n}" is not a top-level declaration in index.html any more`);
  needed.add(n);
  const body = strip(c.body);
  for (const o of names) if (o !== n && !needed.has(o) && uses(body, o)) queue.push(o);
}

// Nothing browser-only may come along
const used = [...needed].map(n => chunks.get(n)).sort((a, b) => a.order - b.order);
for (const c of used) {
  const b = strip(c.body);
  for (const bad of ['document', 'window', 'localStorage', 'fetch(', 'authFetch', 'alert(']) {
    if (b.includes(bad)) throw new Error(`${c.name} uses ${bad} - it can't run in the worker`);
  }
  try { new Function(c.body); } catch (e) { throw new Error(`${c.name}: could not cut it out cleanly (${e.message})`); }
}

const src = `// GENERATED from index.html by tools/build-clubber-rules.mjs - do not edit.
// The dashboard's own Clubber export rules, copied unchanged so the Clubber
// API works out exactly the same club IDs, grade, price, time and venue.
// Change the rules in index.html, then run: node tools/build-clubber-rules.mjs
/* eslint-disable */

export const CLUBBER_RULES_FUNCTIONS = ${JSON.stringify(used.map(c => c.name))};

export function createClubberRules(data = {}) {
${Object.entries(STATE).map(([k, v]) => `  let ${k} = data.${k} || ${v};`).join('\n')}

${used.map(c => c.body.split('\n').map(l => '  ' + l).join('\n')).join('\n\n')}

  return {
${ROOTS.map(r => `    ${r},`).join('\n')}
    // Page-state hooks (the page keeps these in globals)
    setFixtures(list) { fixtures = list; },
    applyOverridesTo(list, overrides) { fixtures = list; fixtureOverrides = overrides || {}; applyOverrides(); return fixtures; },
  };
}
`;

if (process.argv.includes('--check')) {
  const cur = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8').replace(/\r\n/g, '\n') : '';
  if (cur !== src) { console.error('worker/clubber-rules.js is out of date - run node tools/build-clubber-rules.mjs'); process.exit(1); }
  console.log('worker/clubber-rules.js is up to date');
} else {
  fs.writeFileSync(outPath, src);
  console.log(`Wrote worker/clubber-rules.js: ${used.length} declarations from index.html`);
}
