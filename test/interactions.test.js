import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { handleInteraction, toHttpResponse } from '../src/interactions.js';
import { imageAssetPath, parseBestiary } from '../src/monsters.js';
import { verifyKey } from '../src/verify.js';

const monsters = JSON.parse(readFileSync(new URL('../data/creatures.json', import.meta.url), 'utf8')).creatures;
const hunter = {
  member: {
    nick: 'Night Scout',
    user: { id: '100', username: 'scout', global_name: 'Scout' },
  },
};

test('the compact bestiary keeps every creature name and location', () => {
  const text = monsters.map((monster) => {
    const locations = (monster.locations ?? []).map((location) => location.name).join('|');
    return `${monster.name}\t${monster.image ?? ''}\t${locations}`;
  }).join('\n');
  const compact = parseBestiary(`${text}\n`);
  assert.equal(compact.length, monsters.length);
  assert.deepEqual(
    compact.map((monster) => monster.name),
    monsters.map((monster) => monster.name),
  );
  assert.deepEqual(
    compact[0].locations.map((location) => location.name),
    monsters[0].locations.map((location) => location.name),
  );
});

test('every referenced creature image is in data/images', () => {
  for (const monster of monsters) {
    const assetPath = imageAssetPath(monster);
    if (!assetPath) continue;
    assert.equal(existsSync(new URL(`../data/${assetPath}`, import.meta.url)), true, monster.name);
  }
});

test('autocomplete returns matching monster names', async () => {
  const result = await handleInteraction({
    type: 4,
    data: {
      name: 'w',
      options: [{ name: 'monster', value: 'frog', focused: true }],
    },
  }, { monsters, loadImage: async () => null });

  assert.equal(result.type, 8);
  assert.ok(result.data.choices.length > 0);
  assert.ok(result.data.choices.length <= 25);
  assert.ok(result.data.choices.every((choice) => choice.name.toLowerCase().includes('frog')));
});

test('posting a card attaches the monster gif and the going button', async () => {
  const monster = monsters.find((entry) => entry.locations.length > 1);
  const result = await handleInteraction({
    type: 2,
    data: {
      name: 'w',
      options: [
        { name: 'monster', value: monster.name },
        { name: 'location', value: monster.locations[0].name },
        { name: 'minutes', value: 9 },
      ],
    },
    ...hunter,
  }, {
    monsters,
    loadImage: async (assetPath) => {
      assert.equal(assetPath, imageAssetPath(monster));
      return { bytes: new Uint8Array([1]), filename: 'monster.gif', contentType: 'image/gif' };
    },
  });

  assert.equal(result.type, 4);
  assert.equal(result.data.flags, 32768);
  assert.deepEqual(result.data.allowed_mentions, { parse: ['everyone'] });
  assert.equal(result.data.components[0].content, '@everyone');
  assert.equal(result.data.components[1].type, 17);
  assert.equal(JSON.stringify(result.data.components[1]).includes('@everyone'), false);
  assert.equal(result.file.filename, 'monster.gif');
  const container = result.data.components[1];
  assert.equal(container.accent_color, 0x2f6fed);
  assert.match(JSON.stringify(container), new RegExp(monster.locations[0].name));
  assert.match(JSON.stringify(container), /Poof <t:\d+:R> at <t:\d+:t>/);
  assert.match(JSON.stringify(container), /warden:going/);
  assert.match(JSON.stringify(container), /"label":"Killed"/);
  assert.match(JSON.stringify(container), /warden:close/);
  assert.match(JSON.stringify(container), /<@100>/);
});

test('a note sits above the reporter', async () => {
  const result = await handleInteraction({
    type: 2,
    data: {
      name: 'w',
      options: [
        { name: 'monster', value: monsters[0].name },
        { name: 'note', value: 'hole on the left' },
      ],
    },
    ...hunter,
  }, { monsters, loadImage: async () => null });

  const text = result.data.components[1].components
    .filter((component) => component.content)
    .map((component) => component.content);
  const noteAt = text.findIndex((content) => content.startsWith('**Note**'));
  const reportedAt = text.findIndex((content) => content.startsWith('**Reported by**'));
  assert.ok(noteAt !== -1 && noteAt < reportedAt);
});

test('a card closes when the timer has run out', async () => {
  const posted = await handleInteraction({
    type: 2,
    data: { name: 'w', options: [{ name: 'monster', value: monsters[0].name }] },
    ...hunter,
  }, { monsters, loadImage: async () => null });
  const components = JSON.parse(JSON.stringify(posted.data.components).replace(/<t:\d+:R>/, '<t:1:R>'));

  const late = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:going' },
    message: { components },
    member: { user: { id: '200', username: 'ally', global_name: 'Ally' } },
  }, { monsters, loadImage: async () => null });

  const card = JSON.stringify(late.data.components);
  assert.match(card, /"label":"Closed"/);
  assert.equal(card.includes('**Closed**'), false);
  assert.equal(card.includes('Poof'), false);
  assert.equal(card.includes('warden:going'), false);
  assert.equal(card.includes('<@200>'), false);
});

test('only the poster can close a card, and then nobody can join', async () => {
  const posted = await handleInteraction({
    type: 2,
    data: { name: 'w', options: [{ name: 'monster', value: monsters[0].name }] },
    ...hunter,
  }, { monsters, loadImage: async () => null });

  const blocked = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:close' },
    message: { components: posted.data.components },
    member: { user: { id: '200', username: 'ally', global_name: 'Ally' } },
  }, { monsters, loadImage: async () => null });
  assert.equal(blocked.data.content, 'Only the person who posted this can close it.');

  const closed = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:close' },
    message: { components: posted.data.components },
    ...hunter,
  }, { monsters, loadImage: async () => null });
  const card = JSON.stringify(closed.data.components);
  assert.match(card, /"label":"Closed"/);
  assert.equal(card.includes('**Closed**'), false);
  assert.equal(card.includes('Poof'), false);
  assert.equal(card.includes('warden:going'), false);

  const late = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:going' },
    message: { components: closed.data.components },
    member: { user: { id: '200', username: 'ally', global_name: 'Ally' } },
  }, { monsters, loadImage: async () => null });
  assert.equal(late.data.content, 'This one is already closed.');
});

test('a typed location that is not on the list still appears on the card', async () => {
  const monster = monsters.find((entry) => entry.locations.length > 1);
  const result = await handleInteraction({
    type: 2,
    data: {
      name: 'w',
      options: [
        { name: 'monster', value: monster.name },
        { name: 'location', value: 'behind the boat' },
      ],
    },
    ...hunter,
  }, { monsters, loadImage: async () => null });

  assert.equal(result.type, 4);
  assert.match(JSON.stringify(result.data.components), /## in behind the boat/);
});

test('another hunter can join and the reporter cannot', async () => {
  const posted = await handleInteraction({
    type: 2,
    data: { name: 'w', options: [{ name: 'monster', value: monsters[0].name }] },
    ...hunter,
  }, { monsters, loadImage: async () => null });

  const blocked = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:going' },
    message: { components: posted.data.components },
    ...hunter,
  }, { monsters, loadImage: async () => null });
  assert.equal(blocked.data.content, 'Only other people can join this list.');

  const joined = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:going' },
    message: { components: posted.data.components },
    member: { user: { id: '200', username: 'ally', global_name: 'Ally' } },
  }, { monsters, loadImage: async () => null });

  assert.equal(joined.type, 7);
  assert.deepEqual(joined.data.allowed_mentions, { parse: [] });
  assert.match(JSON.stringify(joined.data.components), /<@200>/);
  const select = JSON.stringify(joined.data.components);
  assert.match(select, /"custom_id":"warden:check"/);

  const checked = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:check', values: ['200'] },
    message: { components: joined.data.components },
    member: { user: { id: '300', username: 'scout', global_name: 'Scout' } },
  }, { monsters, loadImage: async () => null });
  assert.match(JSON.stringify(checked.data.components), /✅ <@200>/);

  const unchecked = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:check', values: ['200'] },
    message: { components: checked.data.components },
    member: { user: { id: '300', username: 'scout', global_name: 'Scout' } },
  }, { monsters, loadImage: async () => null });
  assert.equal(JSON.stringify(unchecked.data.components).includes('✅ <@200>'), false);

  const closed = await handleInteraction({
    type: 3,
    data: { custom_id: 'warden:close' },
    message: { components: joined.data.components },
    ...hunter,
  }, { monsters, loadImage: async () => null });
  const closedCard = JSON.stringify(closed.data.components);
  assert.match(closedCard, /"label":"Closed"/);
  assert.equal(closedCard.includes('**Closed**'), false);
  assert.match(closedCard, /<@200>/);
  assert.equal(closedCard.includes('Poof'), false);
  assert.equal(closedCard.includes('warden:check'), false);
});

test('a card with a gif keeps the Discord file fields unnamed except the image', async () => {
  const response = toHttpResponse({
    type: 4,
    data: { flags: 32768 },
    file: { bytes: Uint8Array.from([71, 73, 70]), filename: 'monster.gif', contentType: 'image/gif' },
  });
  const body = await response.text();
  assert.match(body, /name="payload_json"\r\n/);
  assert.equal(body.includes('filename="payload_json"'), false);
  assert.match(body, /name="files\[0\]"; filename="monster\.gif"/);
});

test('discord signatures verify with the application public key', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicHex = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ type: 1 });
  const signature = sign(null, Buffer.from(timestamp + body), privateKey).toString('hex');

  assert.equal(await verifyKey(body, signature, timestamp, publicHex), true);
  assert.equal(await verifyKey(body, signature, timestamp, 'ab'.repeat(32)), false);
  assert.equal(await verifyKey(body, signature, '1', publicHex), false);
});
