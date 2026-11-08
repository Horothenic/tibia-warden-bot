import { closeSavedCards, closeWhenDue, dismissInteraction, editOriginal, rememberCard } from './close.js';
import { missingWardens } from './draptor.js';
import { handleInteraction, postCardMessage, toHttpResponse, TEST_CHANNEL_ID, WARDEN_CHANNEL_ID } from './interactions.js';
import { notifyIfNeeded, markHuntCaught, huntersToNotify } from './hunters.js';
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
      const wardenChannelId = env.WARDEN_CHANNEL_ID || WARDEN_CHANNEL_ID;
      const result = await handleInteraction(interaction, {
        monsters,
        loadImage: (assetPath) => loadImage(env, assetPath),
        wardenChannelId,
        testChannelId: env.TEST_CHANNEL_ID || TEST_CHANNEL_ID,
        postCard: (channelId, card) => postCardMessage(env.DISCORD_TOKEN, channelId, card),
        cards: env.CARDS,
        fetchMissing: (account, character) => missingWardens(account, character),
      });
      const jobs = [];
      if (result.job) {
        jobs.push(finishJob(interaction, result.job));
      }
      if (result.posted) {
        jobs.push(dismissInteraction(interaction));
        if (result.expiresAt) {
          jobs.push(rememberCard(env, result.posted.channelId, result.posted.id, result.expiresAt));
        }
      } else if (result.expiresAt && interaction.application_id && interaction.token) {
        jobs.push(closeWhenDue(env, interaction, result.expiresAt));
      }
      if (result.hunt) jobs.push(notifyHunt(env, result.hunt));
      if (result.caught) jobs.push(markHuntCaught(env.CARDS, result.caught.userIds, result.caught.monsterName));
      if (jobs.length) ctx.waitUntil(Promise.all(jobs));
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

async function finishJob(interaction, job) {
  try {
    const content = await job();
    await editOriginal(interaction, content);
  } catch (error) {
    console.error(error);
    await editOriginal(interaction, 'TibiaDraptor did not answer. Nothing was saved.');
  }
}

async function notifyHunt(env, hunt) {
  try {
    const hunters = await huntersToNotify(env.CARDS, hunt.name);
    await Promise.all(hunters.map((hunter) => notifyIfNeeded(hunter, hunt.name, hunt.place)));
  } catch (error) {
    console.error(error);
  }
}

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
