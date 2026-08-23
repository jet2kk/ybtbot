import { sendSilent, clean, titleOf, authorOf, durationOf, fmtDuration, isPlaylist } from './utils.js';

export class MusicController {
  constructor({ client, manager, config }) {
    this.client = client;
    this.manager = manager;
    this.config = config;
    this.playLocks = new Map();
    this.failures = new Map();
    this.loopModes = new Map(); // 0 OFF -> 1 TRACK -> 2 QUEUE -> 0 OFF
  }

  lock(guildId, fn) {
    const previous = this.playLocks.get(guildId) || Promise.resolve();
    const current = previous.catch(() => {}).then(fn);
    this.playLocks.set(guildId, current);
    current.finally(() => {
      if (this.playLocks.get(guildId) === current) this.playLocks.delete(guildId);
    }).catch(() => {});
    return current;
  }

  player(guildId) {
    return this.manager.getPlayer(guildId);
  }

  async waitForNode(timeoutMs = 30000) {
    const started = Date.now();
    while (!this.manager.useable) {
      if (Date.now() - started > timeoutMs) {
        throw new Error('Lavalink chưa READY. Chờ Render báo node READY rồi thử lại.');
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  async ensureVoice(message) {
    const voice = message.member?.voice?.channel;
    if (!voice) throw new Error('Bạn phải vào voice channel trước.');
    const botVoice = message.guild.members.me?.voice?.channelId;
    if (botVoice && botVoice !== voice.id) throw new Error('Bot đang ở voice channel khác.');
    return voice;
  }

  createPlayer(guild, voiceChannelId, textChannelId) {
    const existing = this.player(guild.id);
    if (existing) return existing;
    return this.manager.createPlayer({
      guildId: guild.id,
      voiceChannelId,
      textChannelId,
      selfDeaf: true,
      selfMute: false,
      volume: 100,
      instaUpdateFiltersFix: true,
      applyVolumeAsFilter: false
    });
  }

  async search(player, query, requester) {
    const text = String(query).trim();
    const isUrl = /^https?:\/\//i.test(text);
    const isSpotify = /spotify\.com\/(track|album|playlist)/i.test(text);
    const isYoutube = /(youtube\.com|youtu\.be)/i.test(text);

    if (isUrl || isSpotify || isYoutube) return player.search(text, requester, true);
    return player.search({ query: text, source: 'ytsearch' }, requester, true);
  }

  async play(message, query) {
    if (!query) throw new Error(`Dùng: ${this.prefix(message.guild.id)}play <tên bài hoặc URL>`);

    return this.lock(message.guild.id, async () => {
      const voice = await this.ensureVoice(message);
      await this.waitForNode();

      let player = this.player(message.guild.id);
      if (player?.voiceChannelId && player.voiceChannelId !== voice.id) {
        throw new Error('Bot đang ở voice channel khác.');
      }

      player = this.createPlayer(message.guild, voice.id, message.channel.id);
      player.textChannelId = message.channel.id;
      if (!player.connected) await player.connect();

      const result = await this.search(player, query, message.author);
      if (!result?.tracks?.length) throw new Error('Không tìm thấy bài hát hoặc playlist.');

      const wasIdle = !player.playing && !player.paused && !player.queue.current;
      const playlist = isPlaylist(result);

      if (playlist) {
        await player.queue.add(result.tracks);
        const total = result.tracks.reduce((sum, track) => sum + Number(durationOf(track) || 0), 0);
        await sendSilent(message.channel, {
          embeds: [{
            color: 0x5865F2,
            description: [
              '➕ **Added Playlist**', '',
              '**Playlist**', clean(result.playlist?.name || 'Playlist'), '',
              '**Playlist Length**', fmtDuration(total), '',
              '**Tracks**', String(result.tracks.length)
            ].join('\n')
          }]
        });
      } else {
        const track = result.tracks[0];
        await player.queue.add(track);
        await sendSilent(message.channel, {
          embeds: [{
            color: 0x5865F2,
            description: `➕ **Added** ${config.playingIcon} **${clean(titleOf(track), 140)}**\nby ${clean(authorOf(track), 120)}`
          }]
        });
      }

      // Exactly one initial play call. autoSkip handles normal track transitions.
      if (wasIdle && !player.playing && !player.paused) await player.play();
    });
  }

  resetGuild(guildId) {
    this.failures.delete(guildId);
    this.loopModes.delete(guildId);
    this.playLocks.delete(guildId);
  }

  resetFailures(guildId) { this.failures.delete(guildId); }

  recordFailure(player, reason) {
    const guildId = player.guildId;
    const now = Date.now();
    const state = this.failures.get(guildId) || [];
    const recent = state.filter(time => now - time < 30000);
    recent.push(now);
    this.failures.set(guildId, recent);
    console.warn(`[LAVALINK] failure ${guildId}: ${reason || 'unknown'} (${recent.length}/3)`);

    if (recent.length >= 3) {
      this.failures.delete(guildId);
      player.stopPlaying(true, false).catch(error => console.warn('[LAVALINK] stop:', error?.message || error));
      return true;
    }
    return false;
  }

  async setRepeatMode(player, mode) {
    if (typeof player.setRepeatMode === 'function') {
      await player.setRepeatMode(mode);
      return;
    }
    // Compatibility fallback for older/newer client builds.
    if (player.repeatMode !== undefined) {
      player.repeatMode = mode;
      return;
    }
    throw new Error('Phiên bản lavalink-client hiện tại không hỗ trợ loop.');
  }

  async cycleLoop(message) {
    const player = this.player(message.guild.id);
    if (!player?.queue?.current) throw new Error('Không có bài đang phát.');

    const current = this.loopModes.get(message.guild.id) ?? 0;
    const next = (current + 1) % 3;
    this.loopModes.set(message.guild.id, next);

    if (next === 1) {
      await this.setRepeatMode(player, 'track');
      return sendSilent(message.channel, { content: '🔂 Loop **1 bài** — lần nữa để loop queue, lần nữa để tắt.' });
    }

    if (next === 2) {
      await this.setRepeatMode(player, 'queue');
      return sendSilent(message.channel, { content: '🔁 Loop **QUEUE** — lần nữa để tắt.' });
    }

    await this.setRepeatMode(player, 'off');
    return sendSilent(message.channel, { content: '🔁 Loop **OFF**.' });
  }

  async setLoopExplicit(message, arg) {
    const player = this.player(message.guild.id);
    if (!player?.queue?.current) throw new Error('Không có bài đang phát.');
    const mode = String(arg || '').toLowerCase();
    if (['off', 'none', '0'].includes(mode)) {
      this.loopModes.set(message.guild.id, 0);
      await this.setRepeatMode(player, 'off');
      return sendSilent(message.channel, { content: '🔁 Loop **OFF**.' });
    }
    if (['queue', 'all', '2'].includes(mode)) {
      this.loopModes.set(message.guild.id, 2);
      await this.setRepeatMode(player, 'queue');
      return sendSilent(message.channel, { content: '🔁 Loop **QUEUE**.' });
    }
    if (['track', 'song', 'one', '1', 'current'].includes(mode)) {
      this.loopModes.set(message.guild.id, 1);
      await this.setRepeatMode(player, 'track');
      return sendSilent(message.channel, { content: '🔂 Loop **1 bài**.' });
    }
    throw new Error('Dùng !loop để chuyển: 1 bài → queue → tắt.');
  }

  async clear(message) {
    const player = this.player(message.guild.id);
    if (!player) throw new Error('Chưa có player.');
    if (typeof player.queue.clear === 'function') await player.queue.clear();
    else await player.queue.remove(player.queue.tracks.slice());
    return sendSilent(message.channel, { content: '🗑️ Đã xóa queue.' });
  }

  prefix(guildId) { return this.getPrefix(guildId); }
  getPrefix(guildId) { return this.prefixStore?.get(guildId, this.config.defaultPrefix) ?? this.config.defaultPrefix; }
  attachPrefixStore(store) { this.prefixStore = store; }
}
