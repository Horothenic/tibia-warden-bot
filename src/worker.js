import { closeSavedCards, closeWhenDue } from './close.js';
import { handleInteraction, toHttpResponse } from './interactions.js';
import { parseBestiary } from './monsters.js';
import { verifyKey } from './verify.js';

let monstersPromise;

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'GET') {
      return new Response('Tibia warden is running. Discord sends commands to this address.', {
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed.', { status: 405 });
    }

    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const body = await request.text();
    const valid = await verifyKey(body, signature, timestamp, env.DISCORD_PUBLIC_KEY);
    if (!valid) return new Response('Invalid request signature.', { status: 401 });

    let interaction;
    try {
      interaction = JSON.parse(body);
    } catch {
      return new Response('Invalid request body.', { status: 400 });
    }

    if (interaction.type === 1) return Response.json({ type: 1 });

    try {
      const monsters = await loadMonsters(env);
      const result = await handleInteraction(interaction, {
        monsters,
        loadImage: (assetPath) => loadImage(env, assetPath),
      });
      if (result.expiresAt && interaction.application_id && interaction.token) {
        ctx.waitUntil(closeWhenDue(env, interaction, result.expiresAt));
      }
      return toHttpResponse(result);
    } catch (error) {
      console.error(error);
      return Response.json({
        type: 4,
        data: { content: 'Could not handle that action.', flags: 64 },
      });
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(closeSavedCards(env));
  },
};

function loadMonsters(env) {
  if (!monstersPromise) {
    monstersPromise = env.ASSETS.fetch(assetRequest('/bestiary.tsv'))
      .then(async (response) => {
        if (!response.ok) throw new Error(`bestiary.tsv returned ${response.status}`);
        return parseBestiary(await response.text());
      })
      .catch((error) => {
        monstersPromise = undefined;
        throw error;
      });
  }
  return monstersPromise;
}

async function loadImage(env, assetPath) {
  if (!assetPath) return null;
  const response = await env.ASSETS.fetch(assetRequest(`/${assetPath}`));
  if (!response.ok) return null;
  const filename = 'monster.gif';
  const contentType = assetPath.endsWith('.png') ? 'image/png' : 'image/gif';
  return { bytes: await response.arrayBuffer(), filename, contentType };
}

function assetRequest(pathname) {
  const url = new URL('https://assets.local');
  url.pathname = pathname
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
  return new Request(url);
}
