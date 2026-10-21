import { MessageFlags, poofComponents } from './party.js';

const API = 'https://discord.com/api/v10';

export async function closeWhenDue(env, interaction, expiresAt) {
  await remember(env, interaction, expiresAt);
}

export async function closeSavedCards(env) {
  if (!env.CARDS || !env.DISCORD_TOKEN) return;
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
  if (!env?.CARDS) return;
  const message = await discord(
    `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`,
  );
  if (!message?.id || !message.channel_id) return;
  const ttl = Math.max(120, expiresAt - Math.floor(Date.now() / 1000) + 3600);
  await env.CARDS.put(`card:${message.channel_id}:${message.id}`, String(expiresAt), {
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
  if (message.components) {
    const components = poofComponents(message.components);
    if (components) {
      await discord(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { authorization: `Bot ${env.DISCORD_TOKEN}` },
        body: JSON.stringify({
          flags: MessageFlags.IsComponentsV2,
          allowed_mentions: { parse: [] },
          components,
        }),
      });
    }
  }
  await env.CARDS.delete(key);
}

async function discord(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });
  if (response.status === 404) return { missing: true };
  if (!response.ok) return null;
  if (response.status === 204) return true;
  return response.json();
}
