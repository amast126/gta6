// Validates content/*.json: JSON parses, ids are unique, every link and src resolves.
// Run: node scripts/check-content.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const dir = path.join(root, 'content');
const read = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));

const sections = read('sections.json');
const sources = read('sources.json');
const ids = new Map();
const problems = [];

const all = sections.map((s) => ({ section: s, items: read(s.file) }));
for (const { section, items } of all) {
  if (section.kind === 'timeline') continue;
  for (const it of items) {
    if (!it.id) problems.push(`${section.file}: entry without id (${it.name})`);
    else if (ids.has(it.id)) problems.push(`${section.file}: duplicate id ${it.id} (also in ${ids.get(it.id)})`);
    else ids.set(it.id, section.file);
  }
}
for (const { section, items } of all) {
  for (const it of items) {
    for (const l of it.links || []) if (!ids.has(l)) problems.push(`${section.file} › ${it.id || it.title}: link "${l}" does not exist`);
    for (const f of it.facts || []) {
      if (!['official', 'reported', 'rumor'].includes(f.status)) problems.push(`${section.file} › ${it.id}: bad status "${f.status}"`);
      if (f.src && !sources[f.src]) problems.push(`${section.file} › ${it.id}: unknown src "${f.src}"`);
      if (!f.src && !f.source) problems.push(`${section.file} › ${it.id}: fact has no source`);
    }
    if (section.kind === 'timeline') {
      if (!it.date || !/^\d{4}-\d{2}-\d{2}$/.test(it.date)) problems.push(`${section.file}: bad date on "${it.title}"`);
      if (it.src && !sources[it.src]) problems.push(`${section.file} › ${it.title}: unknown src "${it.src}"`);
    }
  }
}
const counts = all.map(({ section, items }) => `${section.id}: ${items.length}`).join(', ');
if (problems.length) {
  console.error('Content problems:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log(`Content OK — ${ids.size} entries. ${counts}`);
