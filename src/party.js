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
  Danger: 4,
};

export const MessageFlags = {
  Ephemeral: 64,
  IsComponentsV2: 32768,
};

const GOING_ID = 'warden:going';
const CHECK_ID = 'warden:check';
const CLOSE_ID = 'warden:close';
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

function statusOf(component) {
  if (component?.type !== ComponentType.TextDisplay) return null;
  const content = String(component.content ?? '');
  if (content.startsWith('**Closed**') || content.startsWith('**Killed**') || content.startsWith('**Poofed**')) {
    return 'closed';
  }
  return null;
}

function expiresAtOf(component) {
  let expiresAt = null;
  walk(component);
  return expiresAt;

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.content === 'string') {
      const match = node.content.match(/<t:(\d+):R>/);
      if (match) expiresAt = Number(match[1]);
    }
    for (const child of node.components ?? []) walk(child);
    if (node.accessory) walk(node.accessory);
  }
}

export function readParty(container) {
  const going = [];
  const names = new Map();
  let posterId = null;
  let closed = false;

  for (const component of container.components ?? []) {
    if (component.type === ComponentType.TextDisplay && typeof component.content === 'string') {
      const poster = component.content.match(/\*\*Reported by\*\*\n<@!?(\d+)>/);
      if (poster) posterId = poster[1];
      if (statusOf(component) === 'closed') closed = true;
      if (component.content.startsWith('**Going**\n')) {
        for (const line of component.content.split('\n').slice(1)) {
          const match = line.match(/^(?:(✅) )?<@!?(\d+)>(?: (✅))?$/);
          if (!match) continue;
          going.push({ id: match[2], name: 'Hunter', checked: Boolean(match[1] || match[3]) });
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

  return { going, posterId, closed, expiresAt: expiresAtOf(container) };
}

function goingText(going) {
  const lines = going.length
    ? going.map((person) => `${person.checked ? '✅ ' : ''}<@${person.id}>`)
    : ['—'];
  return { type: ComponentType.TextDisplay, content: `**Going**\n${lines.join('\n')}` };
}

function partyRows(going, status) {
  const rows = [];
  if (going.length && !status) {
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
  if (status) {
    rows.push({
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.Button,
          style: ButtonStyle.Danger,
          label: 'Closed',
          custom_id: CLOSE_ID,
          disabled: true,
        },
      ],
    });
    return rows;
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
      {
        type: ComponentType.Button,
        style: ButtonStyle.Danger,
        label: 'Killed',
        custom_id: CLOSE_ID,
      },
    ],
  });
  return rows;
}

function withoutPoof(content) {
  return content
    .split('\n')
    .filter((line) => !/^#{1,3} Poof <t:\d+:R>$/.test(line))
    .join('\n');
}

function stripPoof(component) {
  if (!component || typeof component !== 'object') return component;
  const next = { ...component };
  if (typeof next.content === 'string') next.content = withoutPoof(next.content);
  if (next.components) next.components = next.components.map(stripPoof);
  return next;
}

export function withParty(container, going, status = null) {
  const body = [];
  for (const component of container.components ?? []) {
    if (isGoingText(component) || statusOf(component)) continue;
    if (component.type === ComponentType.ActionRow) continue;
    body.push(status ? stripPoof(component) : component);
  }

  const reportedAt = () => body.findIndex((component) => (
    component.type === ComponentType.TextDisplay
    && String(component.content ?? '').includes('**Reported by**')
  ));
  const noteAt = () => body.findIndex((component) => (
    component.type === ComponentType.TextDisplay
    && String(component.content ?? '').startsWith('**Note**')
  ));
  if (status) {
    const anchor = noteAt() === -1 ? reportedAt() : noteAt();
    const marker = { type: ComponentType.TextDisplay, content: '**Closed**' };
    if (anchor === -1) body.push(marker);
    else body.splice(anchor, 0, marker);
  }
  const at = reportedAt();
  const text = goingText(going);
  if (at === -1) body.push(text);
  else body.splice(at + 1, 0, text);

  body.push(...partyRows(going, status));
  return { ...container, components: body };
}

export function poofComponents(components) {
  const container = components.find((component) => component.type === ComponentType.Container);
  if (!container) return null;
  const party = readParty(container);
  if (party.closed) return null;
  if (!party.expiresAt || Math.floor(Date.now() / 1000) < party.expiresAt) return null;
  const mention = components.find((component) => component.content === '@everyone')
    ?? { type: ComponentType.TextDisplay, content: '@everyone' };
  return [mention, withParty(container, party.going, 'closed')];
}
