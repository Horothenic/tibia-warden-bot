import { handleInteraction, toHttpResponse } from './interactions.js';
import { verifyKey } from './verify.js';

let monstersPromise;

export default {
  async fetch(request, env) {
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
      return toHttpResponse(result);
    } catch (error) {
      console.error(error);
      return Response.json({
        type: 4,
        data: { content: 'Could not handle that action.', flags: 64 },
      });
    }
  },
};

function loadMonsters(env) {
  if (!monstersPromise) {
    monstersPromise = env.ASSETS.fetch(assetRequest('/creatures.json'))
      .then(async (response) => {
        if (!response.ok) throw new Error(`creatures.json returned ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.creatures)) throw new Error('creatures.json has no creature list');
        return data.creatures;
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
