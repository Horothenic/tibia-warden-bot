import { missingWardens } from './draptor.js';
import { findMonster, imageAssetPath, searchLocations, searchMonsters } from './monsters.js';
import {
  applySync,
  notifyIfNeeded,
  quotaBlock,
  readHunter,
  rememberAlarm,
  writeHunter,
} from './hunters.js';
import {
  actorId,
  applyCheck,
  applyGoing,
  ComponentType,
  hunterName,
  MessageFlags,
  allowedMentions,
  huntName,
  readParty,
  withParty,
} from './party.js';

const InteractionType = {
  Ping: 1,
  ApplicationCommand: 2,
  MessageComponent: 3,
  Autocomplete: 4,
};

const ResponseType = {
  Pong: 1,
  ChannelMessage: 4,
  DeferredChannelMessage: 5,
  UpdateMessage: 7,
  Autocomplete: 8,
};

export const WARDEN_CHANNEL_ID = '1557736230710546482';
export const TEST_CHANNEL_ID = '1568983434586628358';
const API = 'https://discord.com/api/v10';

export async function handleInteraction(interaction, {
  monsters,
  loadImage,
  postCard,
  wardenChannelId = WARDEN_CHANNEL_ID,
  testChannelId = TEST_CHANNEL_ID,
  cards,
  fetchMissing = missingWardens,
}) {
  if (interaction.type === InteractionType.Ping) {
    return { type: ResponseType.Pong };
  }

  if (interaction.type === InteractionType.Autocomplete) {
    return { type: ResponseType.Autocomplete, data: { choices: suggest(interaction, monsters) } };
  }

  if (interaction.type === InteractionType.MessageComponent) {
    return updateParty(interaction);
  }

  if (interaction.type !== InteractionType.ApplicationCommand) {
    return ephemeral('Unknown command.');
  }

  if (interaction.data?.name === 'alarm') {
    return saveAlarm(interaction, cards);
  }
  if (interaction.data?.name === 'update') {
    return queueUpdate(interaction, { cards, fetchMissing });
  }
  if (interaction.data?.name === 'w' || interaction.data?.name === 'w-test') {
    const practice = interaction.data.name === 'w-test';
    return postHunt(interaction, {
      monsters,
      loadImage,
      postCard,
      wardenChannelId: practice ? testChannelId : wardenChannelId,
      reporterId: practice ? randomReporterId(actorId(interaction)) : actorId(interaction),
      notify: true,
    });
  }
  return ephemeral('Unknown command.');
}

async function postHunt(interaction, {
  monsters,
  loadImage,
  postCard,
  wardenChannelId,
  reporterId,
  notify,
}) {

  const monster = findMonster(monsters, optionValue(interaction, 'monster'));
  if (!monster) return ephemeral('Choose a monster from the list.');

  const typedLocation = optionValue(interaction, 'location')?.trim();
  let location = null;
  if (typedLocation) {
    location = monster.locations.find(
      (entry) => entry.name.toLowerCase() === typedLocation.toLowerCase(),
    ) ?? { name: typedLocation.replace(/[\r\n]+/g, ' ') };
  } else if (monster.locations.length === 1) {
    location = monster.locations[0];
  }

  const minutes = optionValue(interaction, 'minutes') ?? 9;
  const note = optionValue(interaction, 'note');
  const expiresAt = Math.floor(Date.now() / 1000) + minutes * 60;
  const image = await loadImage(imageAssetPath(monster));
  const reported = `**Reported by**\n<@${reporterId}>`;
  const noteText = note ? `**Note**\n${note}` : null;
  const heading = {
    type: ComponentType.TextDisplay,
    content: [
      `# ${monster.name}`,
      ...(location ? [`## in ${location.name}`] : []),
      `${location ? '###' : '##'} Poof <t:${expiresAt}:R> at <t:${expiresAt}:t>`,
    ].join('\n'),
  };
  const header = image
    ? [{
        type: ComponentType.Section,
        components: [heading],
        accessory: {
          type: ComponentType.Thumbnail,
          media: { url: 'attachment://monster.gif' },
          description: monster.name,
        },
      }]
    : [heading];

  const components = [
    { type: ComponentType.TextDisplay, content: '@everyone' },
    withParty({
      type: ComponentType.Container,
      accent_color: 0x2f6fed,
      components: [
        ...header,
        { type: ComponentType.Separator, divider: true },
        ...(noteText ? [{ type: ComponentType.TextDisplay, content: noteText }] : []),
        { type: ComponentType.TextDisplay, content: reported },
      ],
    }, []),
  ];
  const card = {
    type: ResponseType.ChannelMessage,
    file: image,
    data: {
      flags: MessageFlags.IsComponentsV2,
      allowed_mentions: allowedMentions(components, { everyone: true }),
      ...(image ? { attachments: [{ id: 0, filename: 'monster.gif' }] } : {}),
      components,
    },
    expiresAt,
    ...(notify ? { hunt: { name: monster.name, place: location?.name ?? null } } : {}),
  };
  if (!interaction.channel_id || interaction.channel_id === wardenChannelId) return card;

  const message = postCard ? await postCard(wardenChannelId, card) : null;
  if (!message?.id) return ephemeral(`Could not post in <#${wardenChannelId}>.`);
  return {
    type: ResponseType.DeferredChannelMessage,
    data: { flags: MessageFlags.Ephemeral },
    expiresAt,
    posted: { id: message.id, channelId: message.channel_id ?? wardenChannelId },
    hunt: card.hunt,
  };
}

export async function postCardMessage(token, channelId, card) {
  if (!token || !channelId) {
    console.error('could not post the card: missing bot token or channel');
    return null;
  }
  const headers = { authorization: `Bot ${token}` };
  let body;
  if (card.file) {
    const encoded = encodeMultipart(card.data, card.file);
    headers['content-type'] = encoded.contentType;
    body = encoded.body;
  } else {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(card.data);
  }
  const response = await fetch(`${API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers,
    body,
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error(`could not post the card: ${response.status} ${detail.slice(0, 180)}`);
    return null;
  }
  return response.json();
}

function updateParty(interaction) {
  const customId = interaction.data?.custom_id;
  const closing = customId === 'warden:close' || customId === 'warden:killed';
  if (customId !== 'warden:going' && customId !== 'warden:check' && !closing) {
    return ephemeral('This card can no longer be updated.');
  }

  const container = interaction.message?.components?.find(
    (component) => component.type === ComponentType.Container,
  );
  if (!container) return ephemeral('This card can no longer be updated.');

  const party = readParty(container);
  const wasClosed = party.closed;
  const expired = Boolean(party.expiresAt && Math.floor(Date.now() / 1000) >= party.expiresAt);
  let status = party.closed || expired ? 'closed' : null;

  if (closing && !status) {
    if (!party.posterId || actorId(interaction) !== party.posterId) {
      return ephemeral('Only the person who posted this can close it.');
    }
    status = 'closed';
  } else if (customId === 'warden:going' && status && party.closed) {
    return ephemeral('This one is already closed.');
  } else if (customId === 'warden:going' && !status) {
    if (party.posterId && actorId(interaction) === party.posterId) {
      return ephemeral('Only other people can join this list.');
    }
    const result = applyGoing(party.going, {
      id: actorId(interaction),
      name: hunterName(interaction),
    });
    if (result === 'full') return ephemeral('The going list is full (25).');
  } else if (customId === 'warden:check' && !status) {
    applyCheck(party.going, interaction.data.values?.[0]);
  } else if (closing && party.closed) {
    return ephemeral('This one is already closed.');
  }

  const components = [
    { type: ComponentType.TextDisplay, content: '@everyone' },
    withParty(container, party.going, status),
  ];
  return {
    type: ResponseType.UpdateMessage,
    data: {
      flags: MessageFlags.IsComponentsV2,
      allowed_mentions: allowedMentions(components),
      components,
    },
    ...(status === 'closed' && !wasClosed ? {
      caught: {
        monsterName: huntName(container),
        userIds: party.going.map((person) => person.id),
      },
    } : {}),
  };
}

function randomReporterId(realId) {
  const stamp = (BigInt(Date.now()) - 1420070400000n) << 22n;
  const noise = BigInt(Math.floor(Math.random() * 4096));
  let id = (stamp + noise).toString();
  if (id === realId) id = (stamp + noise + 1n).toString();
  return id;
}

function suggest(interaction, monsters) {
  if (interaction.data?.name !== 'w' && interaction.data?.name !== 'w-test') return [];
  const focused = interaction.data?.options?.find((entry) => entry.focused);
  if (!focused) return [];

  if (focused.name === 'monster') {
    return searchMonsters(monsters, String(focused.value ?? ''))
      .slice(0, 25)
      .map((monster) => ({ name: monster.name, value: monster.name }));
  }

  if (focused.name === 'location') {
    const monster = findMonster(monsters, optionValue(interaction, 'monster'));
    const locations = monster ? searchLocations(monster, String(focused.value ?? '')) : [];
    return locations.slice(0, 25).map((location) => ({ name: location.name, value: location.name }));
  }

  return [];
}

function optionValue(interaction, name) {
  const match = interaction.data?.options?.find((entry) => entry.name === name);
  return match?.value ?? null;
}

function ephemeral(content) {
  return {
    type: ResponseType.ChannelMessage,
    data: { content, flags: MessageFlags.Ephemeral },
  };
}

const ALARM_ID = /^[A-Za-z0-9_-]{1,64}$/;

async function saveAlarm(interaction, cards) {
  const topic = String(optionValue(interaction, 'id') ?? '').trim();
  if (!ALARM_ID.test(topic)) {
    return ephemeral('The alarm id can use letters, numbers, dashes, and underscores.');
  }
  if (!cards) return ephemeral('The hunter list is not available yet.');
  const discordUserId = actorId(interaction);
  const hunter = await readHunter(cards, discordUserId);
  await writeHunter(cards, {
    discordUserId,
    alarm: topic,
    characters: hunter?.characters ?? [],
    day: hunter?.day ?? null,
    updatesToday: hunter?.updatesToday ?? 0,
    syncedAt: hunter?.syncedAt ?? null,
  });
  await rememberAlarm(cards, discordUserId);
  return ephemeral('Phone alarm saved. A hunt notifies you only when you still need that warden.');
}

function queueUpdate(interaction, { cards, fetchMissing }) {
  const account = cleanName(optionValue(interaction, 'account'));
  const character = cleanName(optionValue(interaction, 'character'));
  if (!account || !character) {
    return ephemeral('Both the account name and the character name are required.');
  }
  if (!cards) return ephemeral('The hunter list is not available yet.');
  return {
    type: ResponseType.DeferredChannelMessage,
    data: { flags: MessageFlags.Ephemeral },
    job: async () => {
      const hunter = await readHunter(cards, actorId(interaction));
      const block = quotaBlock(hunter);
      if (block?.reason === 'daily') {
        return 'Sync limit reached for today. It resets at midnight, Mexico City time.';
      }
      if (block?.reason === 'cooldown') {
        const minutes = block.minutes === 1 ? '1 minute' : `${block.minutes} minutes`;
        return `Wait ${minutes} before syncing again.`;
      }
      try {
        const result = await fetchMissing(account, character);
        const next = applySync(hunter, actorId(interaction), account, character, result);
        await writeHunter(cards, next);
        if (!result.missing.length) return `Saved ${character}. You have every warden on that character.`;
        const count = result.missing.length === 1 ? '1 warden' : `${result.missing.length} wardens`;
        return `Saved ${character}. ${count} still missing.`;
      } catch (error) {
        return error.code ? error.message : 'TibiaDraptor did not answer. Nothing was saved.';
      }
    },
  };
}

function cleanName(value) {
  const name = String(value ?? '').replace(/[\r\n]+/g, ' ').trim();
  return name.slice(0, 50);
}

export function toHttpResponse(result) {
  const payload = result.data === undefined
    ? { type: result.type }
    : { type: result.type, data: result.data };

  if (!result.file) return Response.json(payload);

  const encoded = encodeMultipart(payload, result.file);
  return new Response(encoded.body, {
    headers: { 'content-type': encoded.contentType },
  });
}

function encodeMultipart(payload, file) {
  const boundary = `----warden${crypto.randomUUID().replaceAll('-', '')}`;
  const fileBytes = new Uint8Array(file.bytes);
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="payload_json"\r\n'
    + 'Content-Type: application/json\r\n\r\n'
    + `${JSON.stringify(payload)}\r\n`
    + `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="files[0]"; filename="${file.filename}"\r\n`
    + `Content-Type: ${file.contentType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + fileBytes.length + tail.length);
  body.set(head, 0);
  body.set(fileBytes, head.length);
  body.set(tail, head.length + fileBytes.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}
