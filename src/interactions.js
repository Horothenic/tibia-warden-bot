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

  const typedLocation = optionValue(interaction, 'location');
  let location = null;
  if (typedLocation) {
    location = monster.locations.find(
      (entry) => entry.name.toLowerCase() === typedLocation.trim().toLowerCase(),
    );
    if (!location) return ephemeral(`Choose a location for ${monster.name} from the list.`);
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
      `${location ? '###' : '##'} Poof <t:${expiresAt}:R>`,
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
      ...(image ? { attachments: [{ id: 0, filename: 'monster.gif' }] } : {}),
      components: [
        withParty({
          type: ComponentType.Container,
          accent_color: 0x2f6fed,
          components: [
            ...header,
            { type: ComponentType.Separator, divider: true },
            { type: ComponentType.TextDisplay, content: reported },
            ...(noteText ? [{ type: ComponentType.TextDisplay, content: noteText }] : []),
          ],
        }, []),
      ],
    },
  };
}

function updateParty(interaction) {
  const customId = interaction.data?.custom_id;
  if (customId !== 'warden:going' && customId !== 'warden:check') {
    return ephemeral('This card can no longer be updated.');
  }

  const container = interaction.message?.components?.find(
    (component) => component.type === ComponentType.Container,
  );
  if (!container) return ephemeral('This card can no longer be updated.');

  const party = readParty(container);
  if (customId === 'warden:check') {
    applyCheck(party.going, interaction.data.values?.[0]);
  } else if (party.posterId && actorId(interaction) === party.posterId) {
    return ephemeral('Only other people can join this list.');
  } else {
    const result = applyGoing(party.going, {
      id: actorId(interaction),
      name: hunterName(interaction),
    });
    if (result === 'full') return ephemeral('The going list is full (25).');
  }

  return {
    type: ResponseType.UpdateMessage,
    data: {
      flags: MessageFlags.IsComponentsV2,
      allowed_mentions: { parse: [] },
      components: [withParty(container, party.going)],
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

  const form = new FormData();
  form.append('payload_json', new Blob([JSON.stringify(payload)], { type: 'application/json' }));
  form.append('files[0]', new File([result.file.bytes], result.file.filename, { type: result.file.contentType }));
  return new Response(form);
}
