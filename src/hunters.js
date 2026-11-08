const ALARM_INDEX = 'alarm-index';
const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Mexico_City',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const COOLDOWN_MS = 30 * 60 * 1000;
const DAILY_LIMIT = 5;

export function mexicoCityDay(date = new Date()) {
  return DAY_FORMAT.format(date);
}

export function hunterKey(discordUserId) {
  return `hunter:${discordUserId}`;
}

export async function rememberAlarm(kv, discordUserId) {
  if (!kv || !discordUserId) return;
  const ids = await readAlarmIndex(kv);
  if (ids.includes(discordUserId)) return;
  ids.push(discordUserId);
  await kv.put(ALARM_INDEX, JSON.stringify(ids));
}

export async function huntersToNotify(kv, monsterName) {
  const ready = [];
  for (const discordUserId of await readAlarmIndex(kv)) {
    const hunter = await readHunter(kv, discordUserId);
    if (hunter?.alarm && needsMonster(hunter, monsterName)) ready.push(hunter);
  }
  return ready;
}

async function readAlarmIndex(kv) {
  if (!kv) return [];
  const raw = await kv.get(ALARM_INDEX);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function readHunter(kv, discordUserId) {
  if (!kv || !discordUserId) return null;
  const raw = await kv.get(hunterKey(discordUserId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeHunter(kv, hunter) {
  if (!kv || !hunter?.discordUserId) return;
  await kv.put(hunterKey(hunter.discordUserId), JSON.stringify(hunter));
}

export function quotaBlock(hunter, now = Date.now()) {
  const day = mexicoCityDay(new Date(now));
  const updatesToday = hunter?.day === day ? Number(hunter.updatesToday) || 0 : 0;
  if (updatesToday >= DAILY_LIMIT) return { reason: 'daily' };
  if (hunter?.syncedAt) {
    const remaining = COOLDOWN_MS - (now - Date.parse(hunter.syncedAt));
    if (remaining > 0) return { reason: 'cooldown', minutes: Math.ceil(remaining / 60000) };
  }
  return null;
}

export function needsMonster(hunter, monsterName) {
  const needle = String(monsterName ?? '').toLowerCase();
  if (!needle) return false;
  return (hunter?.characters ?? []).some((character) => (
    (character.missing ?? []).some((name) => name.toLowerCase() === needle)
  ));
}

export function catchMonster(hunter, monsterName) {
  const needle = String(monsterName ?? '').toLowerCase();
  if (!hunter || !needle) return hunter;
  let changed = false;
  const characters = (hunter.characters ?? []).map((character) => {
    const missing = (character.missing ?? []).filter((name) => {
      const drop = name.toLowerCase() === needle;
      if (drop) changed = true;
      return !drop;
    });
    if (missing.length === (character.missing ?? []).length) return character;
    return { ...character, missing };
  });
  if (!changed) return hunter;
  return { ...hunter, characters };
}

export function applySync(hunter, discordUserId, account, character, result, now = Date.now()) {
  const day = mexicoCityDay(new Date(now));
  const updatesToday = (hunter?.day === day ? Number(hunter.updatesToday) || 0 : 0) + 1;
  const nextCharacter = {
    username: account,
    character,
    characterId: result.characterId,
    missing: result.missing,
  };
  const key = characterKey(account, character);
  const characters = (hunter?.characters ?? []).filter((entry) => characterKey(entry.username, entry.character) !== key);
  characters.push(nextCharacter);
  return {
    discordUserId,
    alarm: hunter?.alarm ?? null,
    characters,
    day,
    updatesToday,
    syncedAt: new Date(now).toISOString(),
  };
}

export async function markHuntCaught(kv, userIds, monsterName) {
  if (!kv || !monsterName) return;
  for (const discordUserId of [...new Set(userIds ?? [])]) {
    const hunter = await readHunter(kv, discordUserId);
    if (!hunter) continue;
    const next = catchMonster(hunter, monsterName);
    if (next !== hunter) await writeHunter(kv, next);
  }
}

export async function notifyIfNeeded(hunter, monsterName, place, fetchImpl = fetch) {
  if (!hunter?.alarm || !needsMonster(hunter, monsterName)) return false;
  const response = await fetchImpl(`https://ntfy.sh/${encodeURIComponent(hunter.alarm)}`, {
    method: 'POST',
    headers: { Title: 'Warden' },
    body: place ? `${monsterName} in ${place}` : monsterName,
  });
  return response.ok;
}

function characterKey(account, character) {
  return `${String(account ?? '').toLowerCase()}\n${String(character ?? '').toLowerCase()}`;
}
