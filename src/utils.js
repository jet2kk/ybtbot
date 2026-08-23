import fs from 'node:fs/promises';
import path from 'node:path';
import { MessageFlags } from 'discord.js';

export function fmtDuration(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return 'Unknown';
  const total = Math.floor(n / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function clean(text, max = 200) {
  return String(text ?? 'Unknown')
    .replace(/[\\*_`~|<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function titleOf(track) {
  return track?.info?.title || track?.title || 'Unknown';
}

export function authorOf(track) {
  return track?.info?.author || track?.author || 'Unknown';
}

export function durationOf(track) {
  return track?.info?.length ?? track?.info?.duration ?? track?.duration ?? 0;
}

export function isPlaylist(result) {
  return String(result?.loadType || '').toLowerCase() === 'playlist' || Boolean(result?.playlist);
}

export function silentPayload(payload = {}) {
  return { ...payload, flags: MessageFlags.SuppressNotifications };
}

export async function sendSilent(channel, payload) {
  try {
    return await channel.send(silentPayload(payload));
  } catch (error) {
    console.warn('[SEND]', error?.message || error);
    return null;
  }
}

export async function replySilent(message, payload) {
  try {
    return await message.reply(silentPayload(payload));
  } catch (error) {
    console.warn('[REPLY]', error?.message || error);
    return null;
  }
}

export function parseTime(input) {
  const text = String(input || '').trim();
  if (!/^\d+(?::\d{1,2}){0,2}$/.test(text)) return null;
  const parts = text.split(':').map(Number);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts[1] < 60 && parts[2] < 60) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
}

export function createJsonStore(file) {
  let data = {};
  let writeChain = Promise.resolve();

  async function load() {
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
      data = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      data = {};
    }
    return data;
  }

  async function save() {
    writeChain = writeChain.then(async () => {
      await ensureDir(path.dirname(file));
      const tmp = `${file}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      await fs.rename(tmp, file);
    }).catch(error => console.warn('[STORE] save failed:', error?.message || error));
    return writeChain;
  }

  return {
    async init() { await ensureDir(path.dirname(file)); await load(); },
    get(key, fallback = null) { return data[key] ?? fallback; },
    set(key, value) { data[key] = value; return save(); },
    delete(key) { delete data[key]; return save(); }
  };
}
