import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId || !guildId || token.startsWith('paste-')) {
  console.error('Fill DISCORD_TOKEN, CLIENT_ID, and GUILD_ID in the .env file.');
  process.exit(1);
}

const rest = new REST({ version: '10' }).setToken(token);
const body = commands.map((command) => command.toJSON());

await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
console.log('Registered /w on your server.');
