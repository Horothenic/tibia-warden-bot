import { SlashCommandBuilder } from 'discord.js';

// Flip this, then run `npm run register`, to show or hide /w-test.
export const testCommandEnabled = true;

function huntCommand(name, description) {
  return new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .addStringOption((option) =>
      option
        .setName('monster')
        .setDescription('Monster name')
        .setRequired(true)
        .setAutocomplete(true),
    )
    .addStringOption((option) =>
      option
        .setName('location')
        .setDescription('Where it is. Pick an area, or type your own.')
        .setRequired(false)
        .setAutocomplete(true)
        .setMaxLength(100),
    )
    .addIntegerOption((option) =>
      option
        .setName('minutes')
        .setDescription('Minutes until it poofs. Defaults to 9.')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(10080),
    )
    .addStringOption((option) =>
      option
        .setName('note')
        .setDescription('How to get to the monster')
        .setRequired(false),
    );
}

export const commands = [
  huntCommand('w', 'Post a card for a monster you found'),
  new SlashCommandBuilder()
    .setName('alarm')
    .setDescription('Save the ntfy topic that should receive your hunt alarms')
    .addStringOption((option) =>
      option
        .setName('id')
        .setDescription('Your ntfy topic')
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(64),
    ),
  new SlashCommandBuilder()
    .setName('update')
    .setDescription('Replace one character with the wardens TibiaDraptor says you still need')
    .addStringOption((option) =>
      option
        .setName('account')
        .setDescription('TibiaDraptor account name')
        .setRequired(true)
        .setMaxLength(50),
    )
    .addStringOption((option) =>
      option
        .setName('character')
        .setDescription('Character name on that account')
        .setRequired(true)
        .setMaxLength(50),
    ),
  ...(testCommandEnabled ? [huntCommand('w-test', 'Post a practice card in #tests')] : []),
];
