import { ComponentType, MessageFlags, poofComponents, readParty } from './party.js';

const API = 'https://discord.com/api/v10';

export async function closeWhenDue(env, interaction, expiresAt) {
  await remember(env, interaction, expiresAt);
}

const INDEX_KEY = 'open-cards';

export async function closeSavedCards(env) {
  if (!env.CARDS || !env.DISCORD_TOKEN) {
    console.error('auto-close skipped: the worker has no CARDS store or DISCORD_TOKEN');
    return;
  }
  const cards = await readIndex(env);
  const now = Math.floor(Date.now() / 1000);
  const waiting = [];
  let changed = false;
  for (const card of cards) {
    if (!card?.expiresAt || card.expiresAt > now) {
      waiting.push(card);
      continue;
    }
    const closed = await closeSavedCard(env, card.channelId, card.messageId);
    if (closed) changed = true;
    else waiting.push(card);
  }
  if (!changed) return;
  if (!waiting.length) {
    await env.CARDS.delete(INDEX_KEY);
    return;
  }
  await writeIndex(env, waiting);
}

async function remember(env, interaction, expiresAt) {
  if (!env?.CARDS) {
    console.error('auto-close skipped: the worker has no CARDS store');
    return;
  }
  let message = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await wait(1000);
    message = await discord(
      `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
    );
    if (message?.id && message.channel_id) break;
  }
  if (!message?.id || !message.channel_id) {
    console.error('auto-close skipped: Discord had not saved the card yet');
    return;
  }
  await rememberCard(env, message.channel_id, message.id, expiresAt);
}

export async function rememberCard(env, channelId, messageId, expiresAt) {
  if (!env?.CARDS || !channelId || !messageId) return;
  const cards = (await readIndex(env)).filter(
    (card) => card.channelId !== channelId || card.messageId !== messageId,
  );
  cards.push({ channelId, messageId, expiresAt });
  await writeIndex(env, cards);
}

async function readIndex(env) {
  const raw = await env.CARDS.get(INDEX_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeIndex(env, cards) {
  const now = Math.floor(Date.now() / 1000);
  const latest = cards.reduce((max, card) => Math.max(max, Number(card.expiresAt) || 0), now);
  await env.CARDS.put(INDEX_KEY, JSON.stringify(cards), {
    expirationTtl: Math.max(120, latest - now + 3600),
  });
}

async function closeSavedCard(env, channelId, messageId) {
  const message = await discord(`/channels/${channelId}/messages/${messageId}`, {
    headers: { authorization: `Bot ${env.DISCORD_TOKEN}` },
  });
  if (!message) return false;
  if (message.missing) return true;
  const container = message.components?.find((component) => component.type === ComponentType.Container);
  if (!container) return false;
  if (readParty(container).closed) return true;
  const components = poofComponents(message.components);
  if (!components) {
    console.error(`auto-close could not read the timer on ${channelId}:${messageId}`);
    return false;
  }
  const edited = await discord(`/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: { authorization: `Bot ${env.DISCORD_TOKEN}` },
    body: JSON.stringify({
      flags: MessageFlags.IsComponentsV2,
      allowed_mentions: { parse: [] },
      components,
    }),
  });
  return Boolean(edited);
}

export async function dismissInteraction(interaction) {
  if (!interaction?.application_id || !interaction?.token) return;
  const path = `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt) await wait(1000);
    const result = await discord(path, { method: 'DELETE' });
    if (result && !result.missing) return;
  }
  console.error('could not remove the command acknowledgement');
}

function wait(ms) {
  if (globalThis.scheduler?.wait) return globalThis.scheduler.wait(ms);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function discord(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  if (response.status === 404) return { missing: true };
  if (!response.ok) {
    const detail = await response.text();
    console.error(`Discord ${method} failed: ${response.status} ${detail.slice(0, 180)}`);
    return null;
  }
  if (response.status === 204) return true;
  return response.json();
}
