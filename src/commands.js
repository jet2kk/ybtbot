import { PermissionFlagsBits } from 'discord.js';
import { replySilent, sendSilent, clean, titleOf, authorOf, parseTime } from './utils.js';

export const aliases = {
  play: new Set(['play', 'p']),
  pause: new Set(['pause', 'pa']),
  resume: new Set(['resume', 'r', 'unpause']),
  skip: new Set(['skip', 's']),
  previous: new Set(['previous', 'prev', 'back', 'b']),
  stop: new Set(['stop', 'st']),
  leave: new Set(['leave', 'lv', 'dc']),
  nowplaying: new Set(['nowplaying', 'np', 'now']),
  queue: new Set(['queue', 'q']),
  volume: new Set(['volume', 'vol', 'v']),
  seek: new Set(['seek', 'se']),
  loop: new Set(['loop', 'lp']),
  shuffle: new Set(['shuffle', 'sh']),
  remove: new Set(['remove', 'rm']),
  clear: new Set(['clear', 'c']),
  help: new Set(['help', 'h']),
  ping: new Set(['ping', 'pg']),
  join: new Set(['join']),
  prefix: new Set(['prefix', 'setprefix', 'pf', 'pfx'])
};

export function resolveCommand(input) {
  const command = String(input || '').toLowerCase();
  for (const [name, names] of Object.entries(aliases)) if (names.has(command)) return name;
  return null;
}

export function helpText(prefix) {
  return [
    '**🎵 Pate Music**', '',
    `\`${prefix}play <tên/link>\` / \`${prefix}p\``,
    `\`${prefix}pause\` / \`${prefix}pa\``,
    `\`${prefix}resume\` / \`${prefix}r\``,
    `\`${prefix}skip\` / \`${prefix}s\``,
    `\`${prefix}previous\` / \`${prefix}prev\``,
    `\`${prefix}stop\``,
    `\`${prefix}leave\` / \`${prefix}lv\``,
    `\`${prefix}nowplaying\` / \`${prefix}np\``,
    `\`${prefix}queue\` / \`${prefix}q\``,
    `\`${prefix}volume 0-100\``,
    `\`${prefix}seek 1:30\``,
    `\`${prefix}loop\` / \`${prefix}lp\` → **1 bài → queue → tắt**`,
    `\`${prefix}shuffle\``,
    `\`${prefix}remove <số>\``,
    `\`${prefix}clear\``,
    `\`${prefix}join\``,
    `\`${prefix}ping\``,
    `\`${prefix}prefix <ký tự>\``,
    `\`${prefix}prefix reset\``
  ].join('\n');
}

export function installCommands({ client, music, manager, config, prefixStore }) {
  music.attachPrefixStore(prefixStore);

  client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    const prefix = prefixStore.get(message.guild.id, config.defaultPrefix);
    if (!message.content.startsWith(prefix)) return;

    const body = message.content.slice(prefix.length).trim();
    if (!body) return;
    const [rawCommand, ...args] = body.split(/\s+/);
    const command = resolveCommand(rawCommand);
    if (!command) return;

    try {
      if (command === 'prefix') {
        const allowed = message.member?.permissions?.has(PermissionFlagsBits.ManageGuild) ||
          message.member?.permissions?.has(PermissionFlagsBits.Administrator);
        if (!allowed) throw new Error('Bạn cần quyền Quản lý máy chủ để đổi prefix.');
        const value = String(args[0] || '').trim();
        if (!value) return replySilent(message, { content: `Prefix hiện tại: \`${prefix}\`` });
        if (value.toLowerCase() === 'reset') {
          await prefixStore.delete(message.guild.id);
          return replySilent(message, { content: `✅ Prefix đã về \`${config.defaultPrefix}\`.` });
        }
        if (value.length > 5 || /\s/.test(value)) throw new Error('Prefix phải từ 1-5 ký tự và không có khoảng trắng.');
        await prefixStore.set(message.guild.id, value);
        return replySilent(message, { content: `✅ Prefix mới: \`${value}\`` });
      }

      if (command === 'help') return replySilent(message, { content: helpText(prefix) });

      if (command === 'ping') {
        return replySilent(message, {
          content: `🏓 Discord: **${client.ws.ping}ms**\n🎵 Lavalink: **${manager.useable ? '🟢 READY' : '🔴 OFFLINE'}**`
        });
      }

      if (command === 'play') return music.play(message, args.join(' '));

      if (command === 'join') {
        const voice = await music.ensureVoice(message);
        await music.waitForNode();
        const player = music.createPlayer(message.guild, voice.id, message.channel.id);
        player.textChannelId = message.channel.id;
        if (!player.connected) await player.connect();
        return replySilent(message, { content: '🔊 Đã vào voice channel.' });
      }

      const player = music.player(message.guild.id);
      if (!player) throw new Error('Chưa có player. Dùng play trước.');
      const voice = message.member?.voice?.channelId;
      if (!voice || player.voiceChannelId !== voice) throw new Error('Bạn phải ở cùng voice channel với bot.');

      if (command === 'pause') { await player.pause(); return; }
      if (command === 'resume') { await player.resume(); return; }
      if (command === 'skip') {
        if (!player.queue.current) throw new Error('Không có bài đang phát.');
        await player.skip(); return;
      }
      if (command === 'previous') {
        const previous = await player.queue.shiftPrevious().catch(() => null);
        if (!previous) throw new Error('Không có bài trước.');
        await player.play({ clientTrack: previous }); return;
      }
      if (command === 'stop') { await player.stopPlaying(true, false); return; }
      if (command === 'leave') { await player.destroy('user'); return; }

      if (command === 'nowplaying') {
        const track = player.queue.current;
        if (!track) throw new Error('Không có bài đang phát.');
        return sendSilent(message.channel, {
          embeds: [{ color: 0x5865F2, description: `${config.playingIcon} Started playing **${clean(titleOf(track))}**\nby ${clean(authorOf(track), 120)}` }]
        });
      }

      if (command === 'queue') {
        const current = player.queue.current;
        const tracks = player.queue.tracks || [];
        const lines = [];
        if (current) lines.push(`▶️ **${clean(titleOf(current), 100)}**`, '');
        tracks.slice(0, config.maxQueueDisplay).forEach((track, index) => {
          lines.push(`**${index + 1}.** ${clean(titleOf(track), 90)}${authorOf(track) ? ` — ${clean(authorOf(track), 70)}` : ''}`);
        });
        if (tracks.length > config.maxQueueDisplay) lines.push(`… và ${tracks.length - config.maxQueueDisplay} bài khác.`);
        if (!current && !tracks.length) lines.push('Queue trống.');
        return sendSilent(message.channel, { embeds: [{ color: 0x5865F2, title: '📜 QUEUE', description: lines.join('\n') }] });
      }

      if (command === 'volume') {
        const value = Number(args[0]);
        if (!Number.isInteger(value) || value < 0 || value > 100) throw new Error(`Dùng \`${prefix}volume 0-100\``);
        await player.setVolume(value);
        return replySilent(message, { content: `🔊 Volume: **${value}%**` });
      }

      if (command === 'seek') {
        const seconds = parseTime(args[0]);
        if (seconds === null) throw new Error(`Dùng \`${prefix}seek 1:30\``);
        await player.seek(seconds * 1000); return;
      }

      if (command === 'loop') {
        if (!args[0]) return music.cycleLoop(message);
        return music.setLoopExplicit(message, args[0]);
      }

      if (command === 'shuffle') { await player.queue.shuffle(); return replySilent(message, { content: '🔀 Đã shuffle queue.' }); }

      if (command === 'remove') {
        const index = Number(args[0]) - 1;
        if (!Number.isInteger(index) || index < 0 || index >= player.queue.tracks.length) throw new Error(`Dùng \`${prefix}remove <số>\``);
        await player.queue.remove(index);
        return replySilent(message, { content: '🗑️ Đã xóa bài khỏi queue.' });
      }

      if (command === 'clear') return music.clear(message);
    } catch (error) {
      console.error(`[COMMAND:${command}]`, error);
      await replySilent(message, { content: `❌ ${clean(error?.message || 'Có lỗi xảy ra.', 500)}` });
    }
  });
}
