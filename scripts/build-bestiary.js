import { readFileSync, writeFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../data/creatures.json', import.meta.url), 'utf8'));
const lines = data.creatures.map((monster) => {
  const locations = (monster.locations ?? []).map((location) => location.name).join('|');
  return `${monster.name}\t${monster.image ?? ''}\t${locations}`;
});

writeFileSync(new URL('../data/bestiary.tsv', import.meta.url), `${lines.join('\n')}\n`);
console.log(`Wrote ${lines.length} creatures to data/bestiary.tsv`);
