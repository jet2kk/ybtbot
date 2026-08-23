import 'dotenv/config';

function cleanHost(value) {
  return String(value || '')
    .trim()
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .split('/')[0];
}

const cfg = {
  token: process.env.DISCORD_TOKEN?.trim(),
  port: Number(process.env.PORT || 8080),
  defaultPrefix: (process.env.DEFAULT_PREFIX || '3').trim() || '3',
  dataDir: process.env.DATA_DIR || '/data',
  lavalinkHost: cleanHost(process.env.LAVALINK_HOST),
  lavalinkPort: Number(process.env.LAVALINK_PORT || 443),
  lavalinkSecure: String(process.env.LAVALINK_SECURE ?? 'true').toLowerCase() === 'true',
  lavalinkPassword: process.env.LAVALINK_PASSWORD?.trim(),
  playingIcon: process.env.PLAYING_ICON || '🕷️',
  botStatus: process.env.BOT_STATUS || 'Pate iu bes',
  debug: String(process.env.PLAYER_DEBUG || 'false').toLowerCase() === 'true',
  maxQueueDisplay: 20
};

if (!cfg.token) throw new Error('Missing DISCORD_TOKEN');
if (!cfg.lavalinkHost) throw new Error('Missing LAVALINK_HOST');
if (!cfg.lavalinkPassword) throw new Error('Missing LAVALINK_PASSWORD');
if (!Number.isInteger(cfg.port) || cfg.port < 1 || cfg.port > 65535) throw new Error('Invalid PORT');
if (!Number.isInteger(cfg.lavalinkPort) || cfg.lavalinkPort < 1 || cfg.lavalinkPort > 65535) throw new Error('Invalid LAVALINK_PORT');

export default cfg;
