# Tibia warden

Discord bot that posts a monster card with `/w`, then keeps a going list on that message. It runs as a Cloudflare Worker at `https://warden.horothenic.com`.

The bot stays available. Nothing has to be left running on your computer. In the Discord server where `/w` was registered, use it in any channel. Discord shows the bot as offline; commands still run.

## Update the live bot

Edit the code, creature list, or images, then from this folder run:

```bash
npm install
npm run deploy
```

That publish is what updates Cloudflare. Pushing to GitHub does not update the live bot.

Run `npm run register` again only when the `/w` command itself changes, such as its name or options.

## One-time setup

1. Install dependencies: `npm install`
2. Log in to Cloudflare: `npx wrangler login`
3. In the [Discord developer portal](https://discord.com/developers/applications), open the application and copy the **Public Key**.
4. Store it for the Worker. The command names the slot; paste the public key when asked for the secret value:

   ```bash
   npx wrangler secret put DISCORD_PUBLIC_KEY
   ```

5. Deploy: `npm run deploy`
6. In the Discord portal, set **Interactions Endpoint URL** to `https://warden.horothenic.com`. Discord checks the URL when you save it.
7. Fill `.env` from `.env.example` with the bot token, application id, and server id, then register the command: `npm run register`

`.env` stays on your computer and is not committed. For local Worker checks, put the same public key in `.dev.vars` as `DISCORD_PUBLIC_KEY=...` and run `npm run dev`. Discord can only reach the deployed address.
