import { ComponentType, MessageFlags, poofComponents, readParty } from './party.js';

const API = 'https://discord.com/api/v10';

export async function closeWhenDue(env, interaction, expiresAt) {
  await remember(env, interaction, expiresAt);
}

export async function closeSavedCards(env) {
  if (!env.CARDS || !env.DISCORD_TOKEN) {
    console.error('auto-close skipped: the worker has no CARDS store or DISCORD_TOKEN');
    return;
  }
  let cursor;
  const now = Math.floor(Date.now() / 1000);
  do {
    const listed = await env.CARDS.list({ prefix: 'card:', cursor });
    for (const key of listed.keys) {
      const expiresAt = Number(await env.CARDS.get(key.name));
      if (!expiresAt || expiresAt > now) continue;
      const [, channelId, messageId] = key.name.split(':');
      await closeSavedCard(env, channelId, messageId, key.name);
    }
    cursor = listed.list_complete ? undefined : listed.cursor;
  } while (cursor);
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
  const ttl = Math.max(120, expiresAt - Math.floor(Date.now() / 1000) + 3600);
  await env.CARDS.put(`card:${channelId}:${messageId}`, String(expiresAt), {
    expirationTtl: ttl,
  });
}

async function closeSavedCard(env, channelId, messageId, key) {
  const message = await discord(`/channels/${channelId}/messages/${messageId}`, {
    headers: { authorization: `Bot ${env.DISCORD_TOKEN}` },
  });
  if (!message) return;
  if (message.missing) {
    await env.CARDS.delete(key);
    return;
  }
  const container = message.components?.find((component) => component.type === ComponentType.Container);
  if (!container) return;
  if (readParty(container).closed) {
    await env.CARDS.delete(key);
    return;
  }
  const components = poofComponents(message.components);
  if (!components) {
    console.error(`auto-close could not read the timer on ${key}`);
    return;
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
  if (!edited) return;
  await env.CARDS.delete(key);
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
