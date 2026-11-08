import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySync,
  catchMonster,
  huntersToNotify,
  markHuntCaught,
  needsMonster,
  notifyIfNeeded,
  quotaBlock,
  readHunter,
  rememberAlarm,
  writeHunter,
} from '../src/hunters.js';
import { missingWardens } from '../src/draptor.js';
import { handleInteraction } from '../src/interactions.js';

const ME = '140608069577998336';

function memoryKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

test('a sync keeps every character and replaces only the one named', () => {
  const hunter = applySync(null, ME, 'Horothen', 'Knight', {
    characterId: 1,
    missing: ['Ghoul', 'Rat'],
  }, Date.parse('2026-11-08T18:00:00.000Z'));
  const next = applySync(hunter, ME, 'Horothen', 'Druid', {
    characterId: 2,
    missing: ['Ghoul'],
  }, Date.parse('2026-11-08T19:00:00.000Z'));
  assert.equal(next.characters.length, 2);
  assert.equal(next.updatesToday, 2);
  assert.deepEqual(
    next.characters.find((entry) => entry.character === 'Knight').missing,
    ['Ghoul', 'Rat'],
  );
});

test('catching a monster removes it from every character', async () => {
  const hunter = applySync(null, ME, 'Horothen', 'Knight', {
    characterId: 1,
    missing: ['Ghoul', 'Rat'],
  });
  const both = applySync(hunter, ME, 'Horothen', 'Druid', {
    characterId: 2,
    missing: ['Ghoul'],
  });
  const kv = memoryKv();
  await kv.put(`hunter:${ME}`, JSON.stringify(both));
  await markHuntCaught(kv, [ME, '999'], 'ghoul');
  const saved = await readHunter(kv, ME);
  assert.deepEqual(saved.characters[0].missing, ['Rat']);
  assert.deepEqual(saved.characters[1].missing, []);
  assert.equal(needsMonster(saved, 'Ghoul'), false);
  assert.equal(needsMonster(saved, 'Rat'), true);
});

test('an alarm is sent only while the warden is still missing', async () => {
  const calls = [];
  const hunter = {
    alarm: 'Abcdefghij1234567890Abcdefghij',
    characters: [{ missing: ['Ghoul'] }],
  };
  const sent = await notifyIfNeeded(hunter, 'Ghoul', 'Drefia', 'app-token', async (url, options) => {
    calls.push({ url, body: options.body });
    return { ok: true };
  });
  const params = new URLSearchParams(calls[0].body);
  assert.equal(sent, true);
  assert.equal(calls[0].url, 'https://api.pushover.net/1/messages.json');
  assert.equal(params.get('token'), 'app-token');
  assert.equal(params.get('user'), hunter.alarm);
  assert.equal(params.get('title'), 'Warden');
  assert.equal(params.get('message'), 'Ghoul in Drefia');
  assert.equal(params.get('priority'), '1');
  assert.equal(params.get('sound'), 'siren');

  const skipped = await notifyIfNeeded(
    catchMonster(hunter, 'Ghoul'),
    'Ghoul',
    'Drefia',
    'app-token',
    async () => {
      throw new Error('should not notify');
    },
  );
  assert.equal(skipped, false);
});

test('the daily cap and the cooldown are checked before another sync', () => {
  const now = Date.parse('2026-11-08T18:00:00.000Z');
  const hunter = applySync(null, ME, 'Horothen', 'Knight', {
    characterId: 1,
    missing: [],
  }, now);
  hunter.updatesToday = 5;
  hunter.day = '2026-11-08';
  assert.equal(quotaBlock(hunter, now + 60 * 60 * 1000).reason, 'daily');

  hunter.updatesToday = 1;
  assert.equal(quotaBlock(hunter, now + 10 * 60 * 1000).reason, 'cooldown');
  assert.equal(quotaBlock(hunter, now + 31 * 60 * 1000), null);
});

test('TibiaDraptor locked rows become the missing names', async () => {
  const result = await missingWardens('Horothen', 'Horothen', async (url) => {
    if (url.endsWith('/characters')) {
      return json({ characters: [{ id: 8385, name: 'Horothen', isHidden: 0 }] });
    }
    return json({
      meta: { last_page: 1 },
      data: [
        { name: 'Ghoul', characters: [{ id: 8385, echo_warden: false }] },
        { name: 'Rat', characters: [{ id: 8385, echo_warden: true }] },
        { name: 'Demon', characters: [{ id: 99, echo_warden: false }] },
      ],
    });
  });
  assert.equal(result.characterId, 8385);
  assert.deepEqual(result.missing, ['Ghoul']);
});

test('a hidden profile does not look like an empty list', async () => {
  await assert.rejects(
    () => missingWardens('Horothen', 'Horothen', async () => json({
      characters: [{ id: 1, name: 'Horothen', isHidden: 1 }],
    })),
    (error) => error.code === 'hidden',
  );
});

test('a hunt notifies every person who still needs that warden', async () => {
  const kv = memoryKv();
  await writeHunter(kv, {
    discordUserId: '1',
    alarm: 'Abcdefghij1234567890Abcdefghij',
    characters: [{ missing: ['Ghoul'] }],
  });
  await writeHunter(kv, {
    discordUserId: '2',
    alarm: 'Bbcdefghij1234567890Bbcdefghij',
    characters: [{ missing: ['Rat'] }],
  });
  await rememberAlarm(kv, '1');
  await rememberAlarm(kv, '2');
  const ready = await huntersToNotify(kv, 'Ghoul');
  assert.deepEqual(ready.map((hunter) => hunter.discordUserId), ['1']);
});

test('any member can save an alarm and sync a character', async () => {
  const kv = memoryKv();
  const saved = await handleInteraction({
    type: 2,
    data: { name: 'alarm', options: [{ name: 'key', value: 'Abcdefghij1234567890Abcdefghij' }] },
    member: { user: { id: '999' } },
  }, { monsters: [], cards: kv, loadImage: async () => null });
  assert.match(saved.data.content, /Phone alarm saved/);

  let called = false;
  const queued = await handleInteraction({
    type: 2,
    data: {
      name: 'update',
      options: [
        { name: 'account', value: 'Horothen' },
        { name: 'character', value: 'Knight' },
      ],
    },
    member: { user: { id: '999' } },
  }, {
    monsters: [],
    cards: kv,
    loadImage: async () => null,
    fetchMissing: async () => {
      called = true;
      return { characterId: 7, missing: ['Ghoul'] };
    },
  });
  assert.equal(queued.type, 5);
  assert.equal(await queued.job(), 'Saved Knight. 1 warden still missing.');
  assert.equal(called, true);
  const hunter = await readHunter(kv, '999');
  assert.equal(hunter.alarm, 'Abcdefghij1234567890Abcdefghij');
  assert.deepEqual(hunter.characters[0].missing, ['Ghoul']);
});

function json(body) {
  return {
    ok: true,
    async json() {
      return body;
    },
  };
}
