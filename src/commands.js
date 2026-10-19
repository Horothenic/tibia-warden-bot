import { SlashCommandBuilder } from 'discord.js';

export const commands = [
  new SlashCommandBuilder()
    .setName('w')
    .setDescription('Post a card for a monster you found')
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
        .setDescription('Where it is. Filled for you when the monster has one area.')
        .setRequired(false)
        .setAutocomplete(true),
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
    ),
];
