export const ComponentType = {
  ActionRow: 1,
  Button: 2,
  StringSelect: 3,
  Section: 9,
  TextDisplay: 10,
  Thumbnail: 11,
  Separator: 14,
  Container: 17,
};

export const ButtonStyle = {
  Success: 3,
};

export const MessageFlags = {
  Ephemeral: 64,
  IsComponentsV2: 32768,
};

const GOING_ID = 'warden:going';
const CHECK_ID = 'warden:check';
const LIST_LIMIT = 25;

export function actorId(interaction) {
  return interaction.member?.user?.id ?? interaction.user?.id ?? null;
}

export function hunterName(interaction) {
  const user = interaction.member?.user ?? interaction.user ?? {};
  const raw = interaction.member?.nick
    || interaction.member?.displayName
    || user.global_name
    || user.globalName
    || user.username
    || 'Hunter';
  const name = String(raw).replace(/[\r\n]+/g, ' ').trim();
  return name.slice(0, 80) || 'Hunter';
}

export function applyGoing(going, person) {
  const index = going.findIndex((entry) => entry.id === person.id);
  if (index !== -1) {
    going.splice(index, 1);
    return 'removed';
  }
  if (going.length >= LIST_LIMIT) return 'full';
  going.push({ id: person.id, name: person.name, checked: false });
  return 'added';
}

export function applyCheck(going, userId) {
  const person = going.find((entry) => entry.id === userId);
  if (!person) return false;
  person.checked = !person.checked;
  return true;
}

function isGoingText(component) {
  return component.type === ComponentType.TextDisplay
    && String(component.content ?? '').startsWith('**Going**');
}

export function readParty(container) {
  const going = [];
  const names = new Map();
  let posterId = null;

  for (const component of container.components ?? []) {
    if (component.type === ComponentType.TextDisplay && typeof component.content === 'string') {
      const poster = component.content.match(/\*\*Reported by\*\*\n<@!?(\d+)>/);
      if (poster) posterId = poster[1];
      if (component.content.startsWith('**Going**\n')) {
        for (const line of component.content.split('\n').slice(1)) {
          const match = line.match(/^<@!?(\d+)>( ✅)?$/);
          if (!match) continue;
          going.push({ id: match[1], name: 'Hunter', checked: Boolean(match[2]) });
        }
      }
    }

    if (component.type !== ComponentType.ActionRow) continue;
    for (const child of component.components ?? []) {
      const customId = child.custom_id ?? child.customId;
      if (customId !== CHECK_ID) continue;
      for (const option of child.options ?? []) names.set(option.value, option.label);
    }
  }

  for (const person of going) {
    const name = names.get(person.id);
    if (name) person.name = name;
  }

  return { going, posterId };
}

function goingText(going) {
  const lines = going.length
    ? going.map((person) => `<@${person.id}>${person.checked ? ' ✅' : ''}`)
    : ['—'];
  return { type: ComponentType.TextDisplay, content: `**Going**\n${lines.join('\n')}` };
}

function partyRows(going) {
  const rows = [];
  if (going.length) {
    rows.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: CHECK_ID,
          placeholder: 'Mark as present',
          options: going.map((person) => ({
            label: person.name.slice(0, 100),
            value: person.id,
            description: person.checked ? 'Present' : 'Going',
          })),
        },
      ],
    });
  }
  rows.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Success,
        label: "I'm going",
        custom_id: GOING_ID,
      },
    ],
  });
  return rows;
}

export function withParty(container, going) {
  const body = [];
  for (const component of container.components ?? []) {
    if (isGoingText(component)) continue;
    if (component.type === ComponentType.ActionRow) continue;
    body.push(component);
  }

  const reportedAt = body.findIndex((component) => (
    component.type === ComponentType.TextDisplay
    && String(component.content ?? '').includes('**Reported by**')
  ));
  const text = goingText(going);
  if (reportedAt === -1) body.push(text);
  else body.splice(reportedAt + 1, 0, text);

  body.push(...partyRows(going));
  return { ...container, components: body };
}
