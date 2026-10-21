import { findMonster, imageAssetPath, searchLocations, searchMonsters } from './monsters.js';
import {
  actorId,
  applyCheck,
  applyGoing,
  ComponentType,
  hunterName,
  MessageFlags,
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
  UpdateMessage: 7,
  Autocomplete: 8,
};

export async function handleInteraction(interaction, { monsters, loadImage }) {
  if (interaction.type === InteractionType.Ping) {
    return { type: ResponseType.Pong };
  }

  if (interaction.type === InteractionType.Autocomplete) {
    return { type: ResponseType.Autocomplete, data: { choices: suggest(interaction, monsters) } };
  }

  if (interaction.type === InteractionType.MessageComponent) {
    return updateParty(interaction);
  }

  if (interaction.type !== InteractionType.ApplicationCommand || interaction.data?.name !== 'w') {
    return ephemeral('Unknown command.');
  }

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
  const reported = `**Reported by**\n<@${actorId(interaction)}>`;
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

  return {
    type: ResponseType.ChannelMessage,
    file: image,
    data: {
      flags: MessageFlags.IsComponentsV2,
      allowed_mentions: { parse: ['everyone'] },
      ...(image ? { attachments: [{ id: 0, filename: 'monster.gif' }] } : {}),
      components: [
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
      ],
    },
    expiresAt,
  };
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

  return {
    type: ResponseType.UpdateMessage,
    data: {
      flags: MessageFlags.IsComponentsV2,
      allowed_mentions: { parse: [] },
      components: [
        { type: ComponentType.TextDisplay, content: '@everyone' },
        withParty(container, party.going, status),
      ],
    },
  };
}

function suggest(interaction, monsters) {
  if (interaction.data?.name !== 'w') return [];
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

export function toHttpResponse(result) {
  const payload = result.data === undefined
    ? { type: result.type }
    : { type: result.type, data: result.data };

  if (!result.file) return Response.json(payload);

  const boundary = `----warden${crypto.randomUUID().replaceAll('-', '')}`;
  const fileBytes = new Uint8Array(result.file.bytes);
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n`
    + 'Content-Disposition: form-data; name="payload_json"\r\n'
    + 'Content-Type: application/json\r\n\r\n'
    + `${JSON.stringify(payload)}\r\n`
    + `--${boundary}\r\n`
    + `Content-Disposition: form-data; name="files[0]"; filename="${result.file.filename}"\r\n`
    + `Content-Type: ${result.file.contentType}\r\n\r\n`,
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + fileBytes.length + tail.length);
  body.set(head, 0);
  body.set(fileBytes, head.length);
  body.set(tail, head.length + fileBytes.length);
  return new Response(body, {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  });
}
