# Tibia warden

Discord bot that posts a monster card with `/w`, then keeps a going list on that message. It runs as a Cloudflare Worker. Discord calls the Worker when someone uses the command, autocomplete, or the buttons. There is no process to leave open.

## One-time setup

1. Install dependencies: `npm install`
2. Log in to Cloudflare: `npx wrangler login`
3. In the [Discord developer portal](https://discord.com/developers/applications), open the application and copy the **Public Key**.
4. Store it for the Worker: `npx wrangler secret put DISCORD_PUBLIC_KEY`
5. Deploy: `npm run deploy`
6. Copy the `*.workers.dev` URL Wrangler prints. In the Discord portal, set **Interactions Endpoint URL** to that address. Discord checks the URL when you save it.
7. Fill `.env` from `.env.example` with the bot token, application id, and server id, then register the command: `npm run register`

For local Worker checks, put the same public key in `.dev.vars` as `DISCORD_PUBLIC_KEY=...` and run `npm run dev`. Discord can only reach a deployed URL.

## Update

From this folder, after you pull or edit the bot:

```bash
npm install
npm run deploy
```

`npm run register` is only needed again when the slash command itself changes. Creature data and images in `data/` go up with the deploy.
