import express from 'express';
import path from 'node:path';
import { Client, GatewayIntentBits, Events, ActivityType } from 'discord.js';
import { LavalinkManager } from 'lavalink-client';
import config from './config.js';
import { createJsonStore, sendSilent, clean, titleOf, authorOf } from './utils.js';
import { MusicController } from './music.js';
import { installCommands } from './commands.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const prefixStore = createJsonStore(path.join(config.dataDir, 'prefixes.json'));
await prefixStore.init();

const manager = new LavalinkManager({
  nodes: [{
    id: 'render-main',
    host: config.lavalinkHost,
    port: config.lavalinkPort,
    authorization: config.lavalinkPassword,
    secure: config.lavalinkSecure,
    requestTimeout: 20000,
    retryAmount: 100,
    retryDelay: 5000
  }],
  sendToShard: (guildId, payload) => client.guilds.cache.get(guildId)?.shard?.send(payload),
  autoSkip: true,
  client: { id: '0', username: 'Pate Music' },
  playerOptions: {
    defaultSearchPlatform: 'ytsearch',
    clientBasedPositionUpdateInterval: 250,
    volumeDecrementer: 0.75,
    onDisconnect: { autoReconnect: true, destroyPlayer: false },
    onEmptyQueue: { destroyAfterMs: 300000 },
    useUnresolvedData: true
  },
  queueOptions: { maxPreviousTracks: 20 }
});

client.lavalink = manager;
const music = new MusicController({ client, manager, config });

// IMPORTANT: lavalink-client emits node connection failures on nodeManager.
// EventEmitter treats an unhandled "error" event as a process-level error.
// Always attach the listener before manager.init(), so a temporary 502/1006
// cannot crash the Discord bot. The client will continue its internal retry loop.
manager.nodeManager.on('error', (node, error, payload) => {
  console.error(
    `[LAVALINK] NODE ERROR ${node?.id || 'node'}:`,
    error?.message || error,
    payload ? `| payload=${String(payload)}` : ''
  );
});

// lavalink-client also exposes node errors on the manager in some releases.
// Having both listeners prevents Node.js EventEmitter from treating an
// expected 502/1006/WebSocket outage as an unhandled `error` event.
manager.on('error', (node, error, payload) => {
  console.error(
    `[LAVALINK] MANAGER NODE ERROR ${node?.id || 'node'}:`,
    error?.message || error,
    payload ? `| payload=${String(payload)}` : ''
  );
});
manager.nodeManager.on('connect', (node) => {
  console.log(`[LAVALINK] NODE CONNECTED ${node?.id || 'node'} ${node?.host || config.lavalinkHost}:${node?.port || config.lavalinkPort}`);
  try {
    node.updateSession?.(true, 360000);
  } catch (error) {
    console.warn('[LAVALINK] session resume setup:', error?.message || error);
  }
});
manager.nodeManager.on('reconnecting', (node) => {
  console.warn(`[LAVALINK] NODE RECONNECTING ${node?.id || 'node'}...`);
});
manager.nodeManager.on('reconnectinprogress', (node) => {
  console.warn(`[LAVALINK] NODE RECONNECT IN PROGRESS ${node?.id || 'node'}...`);
});
manager.nodeManager.on('disconnect', (node, reason) => {
  console.warn(`[LAVALINK] NODE DISCONNECT ${node?.id || 'node'}:`, reason || 'unknown');
});
manager.nodeManager.on('resumed', (_node, _payload, players) => {
  console.log(`[LAVALINK] NODE RESUMED | players=${Array.isArray(players) ? players.length : 0}`);
});

manager.on('trackStart', async (player, track) => {
  music.resetFailures(player.guildId);
  const channel = client.channels.cache.get(player.textChannelId);
  if (!channel) return;
  await sendSilent(channel, {
    embeds: [{
      color: 0x5865F2,
      description: `${config.playingIcon} Started playing **${clean(titleOf(track))}**\nby ${clean(authorOf(track), 120)}`
    }]
  });
});

// IMPORTANT: do not call player.play() here. autoSkip handles the next track.
manager.on('trackEnd', (player, track, payload) => {
  if (config.debug) console.log(`[TRACK END] ${player.guildId} ${titleOf(track)} | ${payload?.reason || 'unknown'}`);
});

manager.on('trackError', (player, track, payload) => {
  music.recordFailure(player, payload?.exception?.message || payload?.error || 'trackError');
});

manager.on('trackStuck', (player, track, payload) => {
  music.recordFailure(player, payload?.thresholdMs ? `stuck ${payload.thresholdMs}ms` : 'trackStuck');
});

manager.on('queueEnd', player => {
  if (config.debug) console.log(`[QUEUE END] ${player.guildId}`);
});

client.once(Events.ClientReady, async ready => {
  console.log(`[DISCORD] READY ${ready.user.tag}`);
  manager.options.client.id = ready.user.id;
  manager.options.client.username = ready.user.username;

  try {
    await manager.init({ id: ready.user.id, username: ready.user.username });
    console.log(`[LAVALINK] MANAGER READY | useable=${manager.useable}`);
  } catch (error) {
    console.error('[LAVALINK] INIT ERROR:', error);
  }

  ready.user.setPresence({ activities: [{ name: config.botStatus, type: ActivityType.Listening }], status: 'online' });
});

// If a moderator uses Discord's native right-click -> Disconnect on the bot,
// Discord emits GuildVoiceStateUpdate. Destroy the music player so the bot does
// not immediately reconnect to the same voice channel. Network/Lavalink
// reconnects are still handled by lavalink-client itself.
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  if (newState.id !== client.user?.id) return;
  if (oldState.channelId && !newState.channelId) {
    const player = music.player(newState.guild.id);
    if (player) {
      console.log(`[VOICE] Bot disconnected by Discord | guild=${newState.guild.id}`);
      try { await player.destroy('discord-disconnect'); }
      catch (error) { console.warn('[VOICE] destroy after disconnect:', error?.message || error); }
    }
    music.resetGuild(newState.guild.id);
  }
});

client.on('raw', data => {
  try { manager.sendRawData(data); }
  catch (error) { if (config.debug) console.warn('[LAVALINK RAW]', error?.message || error); }
});

installCommands({ client, music, manager, config, prefixStore });

const app = express();
app.get('/', (_req, res) => res.status(200).json({ ok: true, service: 'pate-music', lavalink: manager.useable, node: config.lavalinkHost }));
app.get('/health', (_req, res) => {
  // Bot process is healthy while Discord is connected. Lavalink can temporarily
  // reconnect without Fly replacing the Bot machine.
  const ok = client.isReady();
  res.status(ok ? 200 : 503).json({
    ok,
    discord: client.isReady(),
    lavalink: manager.useable,
    reconnecting: !manager.useable,
    guilds: client.guilds.cache.size
  });
});
app.listen(config.port, '0.0.0.0', () => console.log(`[HTTP] health server on 0.0.0.0:${config.port}`));

client.on(Events.Error, error => console.error('[DISCORD] client error:', error));
process.on('unhandledRejection', error => console.error('[PROCESS] unhandledRejection:', error));
process.on('uncaughtException', error => console.error('[PROCESS] uncaughtException:', error));

console.log(`[CONFIG] Lavalink = ${config.lavalinkSecure ? 'wss' : 'ws'}://${config.lavalinkHost}:${config.lavalinkPort}`);
console.log(`[CONFIG] Default prefix = ${config.defaultPrefix}`);
console.log(`[CONFIG] Loop = !loop / !lp : TRACK -> QUEUE -> OFF`);
console.log(`[CONFIG] Playing icon = ${config.playingIcon}`);

await client.login(config.token);
