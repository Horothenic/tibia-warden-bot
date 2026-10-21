export function searchMonsters(monsters, query) {
  const q = query.trim().toLowerCase();
  return monsters.filter((monster) => monster.name.toLowerCase().includes(q));
}

export function findMonster(monsters, name) {
  if (!name) return null;
  const q = name.trim().toLowerCase();
  return monsters.find((monster) => monster.name.toLowerCase() === q) ?? null;
}

export function searchLocations(monster, query) {
  const q = query.trim().toLowerCase();
  return monster.locations.filter((location) => location.name.toLowerCase().includes(q));
}

export function imageAssetPath(monster) {
  if (!monster?.image || monster.image.includes('..')) return null;
  return monster.image.replace(/^data\//, '');
}

export function parseBestiary(text) {
  const creatures = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = text.indexOf('\n', cursor);
    if (end === -1) end = text.length;
    const line = text.slice(cursor, end);
    cursor = end + 1;
    if (!line) continue;
    const nameEnd = line.indexOf('\t');
    const imageEnd = line.indexOf('\t', nameEnd + 1);
    const locations = line.slice(imageEnd + 1);
    const image = line.slice(nameEnd + 1, imageEnd);
    creatures.push({
      name: line.slice(0, nameEnd),
      image: image || null,
      locations: locations ? locations.split('|').map((name) => ({ name })) : [],
    });
  }
  return creatures;
}
