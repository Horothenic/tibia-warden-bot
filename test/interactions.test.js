import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { handleInteraction } from '../src/interactions.js';
import { imageAssetPath } from '../src/monsters.js';
import { verifyKey } from '../src/verify.js';

const monsters = JSON.parse(readFileSync(new URL('../data/creatures.json', import.meta.url), 'utf8')).creatures;
const hunter = {
  member: {
    nick: 'Night Scout',
    user: { id: '100', username: 'scout', global_name: 'Scout' },
  },
};

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
  assert.equal(result.file.filename, 'monster.gif');
  const container = result.data.components[0];
  assert.equal(container.accent_color, 0x2f6fed);
  assert.match(JSON.stringify(container), new RegExp(monster.locations[0].name));
  assert.match(JSON.stringify(container), /warden:going/);
  assert.match(JSON.stringify(container), /<@100>/);
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
