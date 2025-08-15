// ========================
//  Discord Bot 完成版
// ========================
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');
require('dotenv').config();

// ----- Bot クライアント -----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,           // スラッシュコマンド / チャンネル作成など
    GatewayIntentBits.GuildMembers,     // 参加/退出ログ、BANなど
    GatewayIntentBits.GuildMessages,    // メッセージ監視
    GatewayIntentBits.MessageContent    // メッセージ内容の取得（必要）
  ]
});

// ----- 重要：環境＆ファイルパス -----
const LOG_CHANNEL_ID = '1405749925580509236'; // 例: '123456789012345678'
const bannedFilePath   = path.join(__dirname, 'bannedWords.json');
const warningsFilePath = path.join(__dirname, 'warnings.json');

// ----- 設定値 -----
const WARNING_LIMIT = 3; // この回数に達すると自動BAN

// ----- 招待リンク許可リスト（コードのみ）-----
// 自分のサーバーの招待コード（discord.gg/XXXXXX の XXXXXX 部分）を入れてください
const allowedInviteCodes = [
  // 'abcdef',
  // '123456'
];

// ========================
//  ユーティリティ
// ========================
function loadJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}
function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}
function loadBannedWords() {
  return loadJson(bannedFilePath, []); // 配列
}
function saveBannedWords(words) {
  saveJson(bannedFilePath, words);
}
function sendLog(guild, content) {
  if (!guild) return;
  const ch = guild.channels.cache.get(LOG_CHANNEL_ID);
  if (ch) ch.send(content).catch(console.error);
}

// データ読み込み
let warnings = loadJson(warningsFilePath, {}); // { userId: count }

// ========================
//  スラッシュコマンド定義
// ========================
const commands = [
  // チケット作成 / 閉鎖
  new SlashCommandBuilder().setName('ticket').setDescription('サポートチケットを作成します'),
  new SlashCommandBuilder()
    .setName('close')
    .setDescription('このチケットを閉じます（チャンネル削除）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  // 禁止ワード管理
  new SlashCommandBuilder()
    .setName('addword')
    .setDescription('禁止ワードを追加します（管理者のみ）')
    .addStringOption(o => o.setName('word').setDescription('追加する禁止ワード').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('removeword')
    .setDescription('禁止ワードを削除します（管理者のみ）')
    .addStringOption(o => o.setName('word').setDescription('削除する禁止ワード').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('listwords')
    .setDescription('現在の禁止ワード一覧を表示します（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // BAN
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('指定したユーザーをBANします（BAN権限必要）')
    .addUserOption(o => o.setName('target').setDescription('BANするユーザー').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('BANの理由').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  // 警告管理
  new SlashCommandBuilder()
    .setName('listwarnings')
    .setDescription('全ユーザーの警告回数を表示します（管理者のみ）')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('checkwarning')
    .setDescription('指定したユーザーの警告回数を確認します（管理者のみ）')
    .addUserOption(o => o.setName('target').setDescription('警告回数を確認するユーザー').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('resetwarning')
    .setDescription('指定したユーザーの警告回数をリセットします（管理者のみ）')
    .addUserOption(o => o.setName('target').setDescription('警告回数をリセットするユーザー').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('リセットの理由（任意）').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // 一括削除 / サーバーステータス
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('指定した数のメッセージを一括削除（最大100）')
    .addIntegerOption(o => o.setName('amount').setDescription('削除するメッセージ数（1〜100）').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('サーバー統計を表示します')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
].map(c => c.toJSON());

// ========================
//  起動時処理（コマンド登録）
// ========================
client.once('ready', async () => {
  console.log(`✅ ログイン完了: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ スラッシュコマンド登録完了');
  } catch (err) {
    console.error('❌ コマンド登録失敗:', err);
  }
});

// ========================
//  メッセージ監視
//   - 招待リンク監視（許可リスト付き）
//   - 禁止ワード検出・警告・自動BAN
// ========================
client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  // --- 招待リンク監視 ---
  // 許可: allowedInviteCodes にコードがあるか
  const inviteRegex = /(discord\.gg\/([A-Za-z0-9\-]+)|discord\.com\/invite\/([A-Za-z0-9\-]+))/i;
  const inviteMatch = message.content.match(inviteRegex);
  if (inviteMatch) {
    const code = (inviteMatch[2] || inviteMatch[3] || '').toLowerCase();
    const allowed = allowedInviteCodes.map(c => c.toLowerCase());
    if (!allowed.includes(code)) {
      await message.delete().catch(() => {});
      const warn = await message.channel.send(`${message.author}, 招待リンクは許可されていません。`).catch(() => {});
      if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
      sendLog(message.guild, `🚫 招待リンク削除: ${message.author.tag} → ${inviteMatch[0]}`);
      return; // 招待リンクに対しては以降の処理をスキップ
    }
  }

  // --- 禁止ワード監視 ---
  const bannedWords = loadBannedWords();
  if (bannedWords.length > 0) {
    const lower = message.content.toLowerCase();
    if (bannedWords.some(w => lower.includes(w))) {
      await message.delete().catch(() => {});
      await message.channel.send(`${message.author}, 不適切な言葉は禁止されています。`).catch(() => {});

      const uid = message.author.id;
      warnings[uid] = (warnings[uid] || 0) + 1;
      saveJson(warningsFilePath, warnings);
      sendLog(message.guild, `⚠️ 警告: ${message.author.tag}（合計 ${warnings[uid]} 回）`);

      // 自動BAN
      if (warnings[uid] >= WARNING_LIMIT) {
        try {
          await message.guild.members.ban(uid, { reason: `警告${WARNING_LIMIT}回で自動BAN` });
          await message.channel.send(`${message.author.tag} は自動BANされました。`).catch(() => {});
          sendLog(message.guild, `⛔ 自動BAN: ${message.author.tag}`);
          delete warnings[uid];
          saveJson(warningsFilePath, warnings);
        } catch (err) {
          console.error('自動BAN失敗:', err);
          sendLog(message.guild, `❌ 自動BAN失敗: ${message.author.tag} (${err.message})`);
        }
      }
    }
  }
});

// ========================
//  ログ機能（参加/退出/削除/編集）
// ========================
client.on('guildMemberAdd', (member) => {
  sendLog(member.guild, `📥 参加: ${member.user.tag}（ID: ${member.id}）`);
});

client.on('guildMemberRemove', (member) => {
  sendLog(member.guild, `📤 退出: ${member.user.tag}（ID: ${member.id}）`);
});

client.on('messageDelete', (message) => {
  if (!message.guild || message.partial) return;
  const author = message.author?.tag || '不明';
  const content = message.content?.slice(0, 1800) || '[埋め込み/ファイル/空]';
  sendLog(message.guild, `🗑️ 削除: ${author}\n#${message.channel?.name}\n${content}`);
});

client.on('messageUpdate', (oldMsg, newMsg) => {
  if (!newMsg.guild || oldMsg.partial || newMsg.partial) return;
  if (oldMsg.content === newMsg.content) return;
  const author = newMsg.author?.tag || '不明';
  const oldContent = (oldMsg.content || '[空]').slice(0, 900);
  const newContent = (newMsg.content || '[空]').slice(0, 900);
  sendLog(newMsg.guild, `✏️ 編集: ${author}\n**旧:** ${oldContent}\n**新:** ${newContent}`);
});

// ========================
//  スラッシュコマンド処理
// ========================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const name = interaction.commandName;

  // --- チケット作成 ---
  if (name === 'ticket') {
    const guild = interaction.guild;
    const user  = interaction.user;

    // 管理者ロール（最初に見つかったAdmin権限ロールを許可）
    const adminRole = guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator));

    const channel = await guild.channels.create({
      name: `ticket-${user.username}`.substring(0, 90),
      type: 0, // GuildText
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id,  allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        ...(adminRole ? [{ id: adminRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }] : [])
      ]
    });

    await channel.send(`${user} さんのサポートチケットです。運営が対応します。`).catch(() => {});
    await interaction.reply({ content: `チケットを作成しました: ${channel}`, flags: MessageFlags.Ephemeral });
    sendLog(guild, `🎫 チケット作成: ${user.tag} → ${channel}`);
    return;
  }

  // --- チケット閉鎖 ---
  if (name === 'close') {
    if (interaction.channel?.name?.startsWith('ticket-')) {
      await interaction.reply({ content: 'チケットを閉じます…', flags: MessageFlags.Ephemeral });
      setTimeout(() => interaction.channel.delete().catch(console.error), 2000);
      sendLog(interaction.guild, `🧹 チケット削除: ${interaction.channel.name}`);
    } else {
      await interaction.reply({ content: 'ここはチケットチャンネルではありません。', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // --- 禁止ワード管理 ---
  if (name === 'addword') {
    const word = interaction.options.getString('word').toLowerCase().trim();
    const words = loadBannedWords();
    if (!words.includes(word)) {
      words.push(word);
      saveBannedWords(words);
      await interaction.reply({ content: `禁止ワード「${word}」を追加しました。`, flags: MessageFlags.Ephemeral });
      sendLog(interaction.guild, `➕ 禁止ワード追加: ${word}（by ${interaction.user.tag}）`);
    } else {
      await interaction.reply({ content: `「${word}」は既に登録済みです。`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (name === 'removeword') {
    const word = interaction.options.getString('word').toLowerCase().trim();
    let words = loadBannedWords();
    if (words.includes(word)) {
      words = words.filter(w => w !== word);
      saveBannedWords(words);
      await interaction.reply({ content: `禁止ワード「${word}」を削除しました。`, flags: MessageFlags.Ephemeral });
      sendLog(interaction.guild, `➖ 禁止ワード削除: ${word}（by ${interaction.user.tag}）`);
    } else {
      await interaction.reply({ content: `「${word}」は登録されていません。`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (name === 'listwords') {
    const words = loadBannedWords();
    await interaction.reply({
      content: `禁止ワード一覧:\n${words.join(', ') || 'なし'}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // --- BAN ---
  if (name === 'ban') {
    const target = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason') || '理由未記入';
    try {
      await interaction.guild.members.ban(target.id, { reason });
      await interaction.reply({ content: `${target.tag} をBANしました。\n理由: ${reason}`, flags: MessageFlags.Ephemeral });
      sendLog(interaction.guild, `⛔ 手動BAN: ${target.tag}（by ${interaction.user.tag}）理由: ${reason}`);
    } catch (err) {
      await interaction.reply({ content: `BANに失敗しました: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // --- 警告一覧 ---
  if (name === 'listwarnings') {
    if (Object.keys(warnings).length === 0) {
      await interaction.reply({ content: '警告を受けたユーザーはいません。', flags: MessageFlags.Ephemeral });
      return;
    }
    let list = '警告回数一覧:\n';
    for (const [uid, count] of Object.entries(warnings)) {
      const u = await client.users.fetch(uid).catch(() => null);
      list += `${u ? u.tag : uid} : ${count}回\n`;
    }
    await interaction.reply({ content: list, flags: MessageFlags.Ephemeral });
    return;
  }

  // --- 警告確認 ---
  if (name === 'checkwarning') {
    const targetUser = interaction.options.getUser('target');
    const count = warnings[targetUser.id] || 0;
    const remaining = Math.max(WARNING_LIMIT - count, 0);
    const status = remaining === 0 ? '※次回違反でBAN' : `あと ${remaining} 回でBAN`;
    await interaction.reply({
      content: `${targetUser.tag} の警告回数は ${count} 回です。\n${status}`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  // --- 警告リセット ---
  if (name === 'resetwarning') {
    const targetUser = interaction.options.getUser('target');
    const reason = interaction.options.getString('reason') || '理由は指定されていません';
    if (!warnings[targetUser.id]) {
      await interaction.reply({ content: `${targetUser.tag} は警告を受けていません。`, flags: MessageFlags.Ephemeral });
      return;
    }
    delete warnings[targetUser.id];
    saveJson(warningsFilePath, warnings);
    try {
      await targetUser.send(`警告回数がリセットされました。\n理由: ${reason}`);
    } catch {}
    await interaction.reply({ content: `${targetUser.tag} の警告回数をリセットしました。`, flags: MessageFlags.Ephemeral });
    sendLog(interaction.guild, `♻️ 警告リセット: ${targetUser.tag}（by ${interaction.user.tag}）理由: ${reason}`);
    return;
  }

  // --- 一括削除 ---
  if (name === 'purge') {
    const amount = interaction.options.getInteger('amount');
    if (amount < 1 || amount > 100) {
      await interaction.reply({ content: '削除数は 1〜100 の間で指定してください。', flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      await interaction.channel.bulkDelete(amount, true);
      await interaction.reply({ content: `${amount} 件のメッセージを削除しました。`, flags: MessageFlags.Ephemeral });
      sendLog(interaction.guild, `🧽 一括削除: #${interaction.channel.name} にて ${amount} 件（by ${interaction.user.tag}）`);
    } catch (err) {
      await interaction.reply({ content: `削除に失敗しました: ${err.message}`, flags: MessageFlags.Ephemeral });
    }
    return;
  }

  // --- サーバー統計 ---
  if (name === 'stats') {
    const guild = interaction.guild;

    // 可能ならメンバーキャッシュを更新（大規模ギルドでは部分的）
    await guild.members.fetch({ withPresences: false }).catch(() => {});

    const totalMembers = guild.memberCount;
    const botCount = guild.members.cache.filter(m => m.user.bot).size;
    const channelCount = guild.channels.cache.size;
    const roleCount = guild.roles.cache.size;
    const created = `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`; // 相対時間表示

    const stats = [
      '📊 **サーバー統計**',
      `🪪 サーバー名: ${guild.name}`,
      `👑 オーナー: ${guild.ownerId}`,
      `🗓️ 作成: ${created}`,
      `👥 メンバー: ${totalMembers}（うち🤖 ${botCount}）`,
      `📂 チャンネル: ${channelCount}`,
      `🏷️ ロール: ${roleCount}`
    ].join('\n');

    await interaction.reply({ content: stats, flags: MessageFlags.Ephemeral });
    return;
  }
});

// ========================
//  最後にログイン
// ========================
client.login(process.env.DISCORD_TOKEN);
