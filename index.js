const { 
  Client, GatewayIntentBits, Partials, 
  REST, Routes, SlashCommandBuilder, PermissionFlagsBits 
} = require('discord.js');
const fs = require('fs-extra');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// -------------------------
// 保存ファイル
// -------------------------
const warningFile = 'warnings.json';
let warnings = fs.existsSync(warningFile) ? fs.readJsonSync(warningFile) : {};
const saveWarnings = () => fs.writeJsonSync(warningFile, warnings, { spaces: 2 });

const reactionRoleFile = 'reactionRoles.json';
let reactionRoles = fs.existsSync(reactionRoleFile) ? fs.readJsonSync(reactionRoleFile) : {};
const saveReactionRoles = () => fs.writeJsonSync(reactionRoleFile, reactionRoles, { spaces: 2 });

const settingsFile = 'settings.json';
let settings = fs.existsSync(settingsFile) ? fs.readJsonSync(settingsFile) : {};
const saveSettings = () => fs.writeJsonSync(settingsFile, settings, { spaces: 2 });

const badWordsFile = 'badwords.json';
let badWords = fs.existsSync(badWordsFile) ? fs.readJsonSync(badWordsFile) : [];
const saveBadWords = () => fs.writeJsonSync(badWordsFile, badWords, { spaces: 2 });

// -------------------------
// スラッシュコマンド定義
// -------------------------
const commands = [
  new SlashCommandBuilder()
    .setName('setreactionrole')
    .setDescription('リアクションでロールを付与できる設定をします')
    .addStringOption(opt => opt.setName('messageid').setDescription('メッセージID').setRequired(true))
    .addStringOption(opt => opt.setName('emoji').setDescription('リアクション絵文字').setRequired(true))
    .addRoleOption(opt => opt.setName('role').setDescription('付与するロール').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('ユーザーに警告を与える')
    .addUserOption(opt => opt.setName('user').setDescription('警告するユーザー').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('ユーザーの警告回数を確認する')
    .addUserOption(opt => opt.setName('user').setDescription('確認するユーザー').setRequired(true)),

  new SlashCommandBuilder()
    .setName('setwelcome')
    .setDescription('ウェルカムメッセージを送信するチャンネルを設定します')
    .addChannelOption(opt => opt.setName('channel').setDescription('ウェルカムチャンネル').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('setlog')
    .setDescription('ログを出力するチャンネルを設定します')
    .addChannelOption(opt => opt.setName('channel').setDescription('ログチャンネル').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('サポートチケットを作成します'),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('このチケットを閉じます（チャンネル削除）')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('addbadword')
    .setDescription('禁止ワードを追加します')
    .addStringOption(opt => opt.setName('word').setDescription('追加する禁止ワード').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('removebadword')
    .setDescription('禁止ワードを削除します')
    .addStringOption(opt => opt.setName('word').setDescription('削除する禁止ワード').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('listbadwords')
    .setDescription('禁止ワード一覧を表示します')
].map(cmd => cmd.toJSON());

// -------------------------
// Bot起動時
// -------------------------
client.once('ready', async () => {
  console.log(`✅ ログイン完了: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ スラッシュコマンド登録完了！');
  } catch (err) {
    console.error('❌ コマンド登録失敗:', err);
  }
});

// -------------------------
// スラッシュコマンド処理
// -------------------------
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // リアクションロール
  if (interaction.commandName === 'setreactionrole') {
    const messageId = interaction.options.getString('messageid');
    const emoji = interaction.options.getString('emoji');
    const role = interaction.options.getRole('role');
    if (!reactionRoles[messageId]) reactionRoles[messageId] = {};
    reactionRoles[messageId][emoji] = role.id;
    saveReactionRoles();
    await interaction.reply({ content: `✅ リアクションロール設定完了！`, flags: 64 });
  }

  // 警告
  if (interaction.commandName === 'warn') {
    const user = interaction.options.getUser('user');
    if (!warnings[user.id]) warnings[user.id] = 0;
    warnings[user.id]++;
    saveWarnings();
    await interaction.reply(`${user} に警告を与えました。現在の警告回数: ${warnings[user.id]}`);
    if (warnings[user.id] >= 3) {
      const member = await interaction.guild.members.fetch(user.id);
      if (member.bannable) {
        await member.ban({ reason: '警告回数が上限に達しました' });
        logEvent(interaction.guild, `⛔ ${user.tag} を自動BANしました。`);
      }
    }
  }

  // 警告確認
  if (interaction.commandName === 'warnings') {
    const user = interaction.options.getUser('user');
    const count = warnings[user.id] || 0;
    await interaction.reply(`${user.tag} の警告回数: ${count}`);
  }

  // ウェルカム設定
  if (interaction.commandName === 'setwelcome') {
    const channel = interaction.options.getChannel('channel');
    settings.welcomeChannel = channel.id;
    saveSettings();
    await interaction.reply({ content: `✅ ウェルカムチャンネルを ${channel} に設定しました！`, flags: 64 });
  }

  // ログチャンネル設定
  if (interaction.commandName === 'setlog') {
    const channel = interaction.options.getChannel('channel');
    settings.logChannel = channel.id;
    saveSettings();
    await interaction.reply({ content: `✅ ログチャンネルを ${channel} に設定しました！`, flags: 64 });
  }

  // チケット
  if (interaction.commandName === 'ticket') {
    const guild = interaction.guild;
    const user = interaction.user;
    const channel = await guild.channels.create({
      name: `ticket-${user.username}`,
      type: 0,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
        { id: guild.roles.cache.find(r => r.permissions.has(PermissionFlagsBits.Administrator)).id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]
    });
    await channel.send(`${user} さんのサポートチケットです。管理者が対応します。`);
    await interaction.reply({ content: `✅ チケットを作成しました: ${channel}`, flags: 64 });
  }

  if (interaction.commandName === 'close') {
    if (interaction.channel.name.startsWith('ticket-')) {
      await interaction.reply('このチケットを閉じます...');
      setTimeout(() => interaction.channel.delete().catch(console.error), 2000);
    } else {
      await interaction.reply({ content: '❌ ここはチケットチャンネルではありません。', flags: 64 });
    }
  }

  // 禁止ワード管理
  if (interaction.commandName === 'addbadword') {
    const word = interaction.options.getString('word');
    if (!badWords.includes(word)) {
      badWords.push(word);
      saveBadWords();
      await interaction.reply(`✅ 禁止ワード「${word}」を追加しました。`);
    } else {
      await interaction.reply(`⚠️ 「${word}」はすでに禁止ワードに登録されています。`);
    }
  }

  if (interaction.commandName === 'removebadword') {
    const word = interaction.options.getString('word');
    if (badWords.includes(word)) {
      badWords = badWords.filter(w => w !== word);
      saveBadWords();
      await interaction.reply(`✅ 禁止ワード「${word}」を削除しました。`);
    } else {
      await interaction.reply(`⚠️ 「${word}」は禁止ワードに登録されていません。`);
    }
  }

  if (interaction.commandName === 'listbadwords') {
    if (badWords.length === 0) {
      await interaction.reply('🚫 現在、禁止ワードは登録されていません。');
    } else {
      await interaction.reply(`🚫 禁止ワード一覧:\n${badWords.join(', ')}`);
    }
  }
});

// -------------------------
// リアクションロール付与/削除
// -------------------------
client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (!reactionRoles[reaction.message.id]) return;
  const roleId = reactionRoles[reaction.message.id][reaction.emoji.name];
  if (!roleId) return;
  const member = await reaction.message.guild.members.fetch(user.id);
  await member.roles.add(roleId).catch(console.error);
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (!reactionRoles[reaction.message.id]) return;
  const roleId = reactionRoles[reaction.message.id][reaction.emoji.name];
  if (!roleId) return;
  const member = await reaction.message.guild.members.fetch(user.id);
  await member.roles.remove(roleId).catch(console.error);
});

// -------------------------
// メッセージ監視（リンク検知 & 禁止ワード）
// -------------------------
client.on('messageCreate', async message => {
  if (message.author.bot) return;

  const inviteRegex = /(discord\.gg|discordapp\.com\/invite)/i;
  if (inviteRegex.test(message.content)) {
    await message.delete().catch(() => {});
    addWarning(message, '招待リンク投稿');
  }

  for (const word of badWords) {
    if (message.content.includes(word)) {
      await message.delete().catch(() => {});
      addWarning(message, `禁止ワード「${word}」`);
      break;
    }
  }
});

// -------------------------
// ウェルカムメッセージ
// -------------------------
client.on('guildMemberAdd', async member => {
  if (!settings.welcomeChannel) return;
  const channel = member.guild.channels.cache.get(settings.welcomeChannel);
  if (channel) channel.send(`🎉 ようこそ ${member} さん！サーバーを楽しんでね！`);
});

// -------------------------
// 警告付与とログ出力
// -------------------------
async function addWarning(message, reason) {
  if (!warnings[message.author.id]) warnings[message.author.id] = 0;
  warnings[message.author.id]++;
  saveWarnings();

  message.channel.send(`${message.author} 🚨 ${reason} が検出されました！警告: ${warnings[message.author.id]}`);
  logEvent(message.guild, `⚠️ ${message.author.tag} に警告（理由: ${reason}）`);

  if (warnings[message.author.id] >= 3) {
    const member = await message.guild.members.fetch(message.author.id);
    if (member.bannable) {
      await member.ban({ reason: `${reason}による自動BAN` });
      message.channel.send(`${message.author.tag} を自動BANしました。`);
      logEvent(message.guild, `⛔ ${message.author.tag} を自動BANしました。`);
    }
  }
}

// -------------------------
// ログ関数
// -------------------------
function logEvent(guild, text) {
  if (!settings.logChannel) return;
  const channel = guild.channels.cache.get(settings.logChannel);
  if (channel) channel.send(text);
}

// -------------------------
// Botログイン
// -------------------------
client.login(process.env.DISCORD_TOKEN);
