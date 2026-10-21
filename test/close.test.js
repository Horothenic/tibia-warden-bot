import assert from 'node:assert/strict';
import test from 'node:test';
import { closeSavedCards } from '../src/close.js';

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

function memoryCards(entries) {
  const store = new Map(Object.entries(entries));
  return {
    store,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async delete(key) {
      store.delete(key);
    },
    async list() {
      return {
        keys: [...store.keys()].map((name) => ({ name })),
        list_complete: true,
      };
    },
  };
}

test('a failed close keeps the card for the next minute', async () => {
  const cards = memoryCards({ 'card:10:20': '1' });
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
  assert.equal(cards.store.has('card:10:20'), true);
});

test('a successful close forgets the card', async () => {
  const cards = memoryCards({ 'card:10:20': '1' });
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
  assert.equal(cards.store.has('card:10:20'), false);
});

test('auto-close does nothing without the bot token', async () => {
  const cards = memoryCards({ 'card:10:20': '1' });
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
  assert.equal(cards.store.has('card:10:20'), true);
});
