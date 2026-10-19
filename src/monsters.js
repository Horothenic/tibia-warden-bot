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
