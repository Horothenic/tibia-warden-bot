import assert from 'node:assert/strict';
import test from 'node:test';
import { closeSavedCards, rememberCard } from '../src/close.js';

const DUE = [{ channelId: '10', messageId: '20', expiresAt: 1 }];

function openCard() {
  return {
    id: '20',
    channel_id: '10',
    components: [
      { type: 10, content: '@everyone' },
      {
        type: 17,
        components: [
          { type: 10, content: '# Ghoul\n### Poof <t:1:R> at <t:1:t>' },
          { type: 10, content: '**Reported by**\n<@100>' },
        ],
      },
    ],
  };
}

function memoryCards(cards) {
  const store = new Map();
  if (cards) store.set('open-cards', JSON.stringify(cards));
  const kv = {
    store,
    writes: 0,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      kv.writes += 1;
      store.set(key, value);
    },
    async delete(key) {
      kv.writes += 1;
      store.delete(key);
    },
    async list() {
      throw new Error('listing cards is over the free daily limit');
    },
  };
  return kv;
}

test('a failed close keeps the card for the next minute', async () => {
  const cards = memoryCards(DUE);
  const calls = [];
  const original = globalThis.fetch;
  const log = console.error;
  console.error = () => {};
  globalThis.fetch = async (url, options = {}) => {
    calls.push(options.method ?? 'GET');
    if ((options.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(openCard()), { status: 200 });
    }
    return new Response('rate limited', { status: 429 });
  };
  try {
    await closeSavedCards({ CARDS: cards, DISCORD_TOKEN: 'bot-token' });
  } finally {
    globalThis.fetch = original;
    console.error = log;
  }
  assert.deepEqual(calls, ['GET', 'PATCH']);
  assert.equal(cards.writes, 0);
  assert.deepEqual(JSON.parse(cards.store.get('open-cards')), DUE);
});

test('a successful close forgets the card', async () => {
  const cards = memoryCards(DUE);
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, options = {}) => {
    if ((options.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify(openCard()), { status: 200 });
    }
    return new Response(null, { status: 204 });
  };
  try {
    await closeSavedCards({ CARDS: cards, DISCORD_TOKEN: 'bot-token' });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(cards.store.has('open-cards'), false);
});

test('a card that is not due yet is left untouched', async () => {
  const waiting = [{ channelId: '10', messageId: '20', expiresAt: 4_000_000_000 }];
  const cards = memoryCards(waiting);
  let called = false;
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 500 });
  };
  try {
    await closeSavedCards({ CARDS: cards, DISCORD_TOKEN: 'bot-token' });
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(called, false);
  assert.equal(cards.writes, 0);
});

test('auto-close does nothing without the bot token', async () => {
  const cards = memoryCards(DUE);
  let called = false;
  const original = globalThis.fetch;
  const log = console.error;
  console.error = () => {};
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 500 });
  };
  try {
    await closeSavedCards({ CARDS: cards });
  } finally {
    globalThis.fetch = original;
    console.error = log;
  }
  assert.equal(called, false);
  assert.equal(cards.writes, 0);
  assert.deepEqual(JSON.parse(cards.store.get('open-cards')), DUE);
});

test('saving a card updates one list instead of creating a new key', async () => {
  const cards = memoryCards([]);
  await rememberCard({ CARDS: cards }, '10', '20', 1);
  await rememberCard({ CARDS: cards }, '10', '21', 2);
  await rememberCard({ CARDS: cards }, '10', '20', 3);
  assert.equal(cards.store.size, 1);
  assert.deepEqual(JSON.parse(cards.store.get('open-cards')), [
    { channelId: '10', messageId: '21', expiresAt: 2 },
    { channelId: '10', messageId: '20', expiresAt: 3 },
  ]);
});
