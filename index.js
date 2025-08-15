const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('fs-extra');
const path = require('path');
const express = require('express');
require('dotenv').config();

// ====== Express サーバー（Render常時稼働対策） ======
const app = express();
app.get('/', (req, res) => res.send('Bot is running!'));
app.listen(process.env.PORT || 3000, () => {
  console.log(`Web server running on port ${process.env.PORT || 3000}`);
});

// ====== Discord Bot 設定 ======
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const bannedWordsPath = path.join(__dirname, 'bannedWords.json');
const warningsPath = path.join(__dirname, 'warnings.json');
const bannedWords = fs.readJsonSync(bannedWordsPath);
let warnings = fs.readJsonSync(warningsPath);

// ====== スラッシュコマンド定義 ======
const commands = [
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('サポートチケットを作成します'),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('チケットを閉じます')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('ユーザーに警告を与えます')
    .addUserOption(opt => opt.setName('target').setDescription('対象ユーザー').setRequired(true)),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('警告回数を確認します')
    .addUserOption(opt => opt.setName('target').setDescription('対象ユーザー').setRequired(true)),

  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('メッセージを一括削除します')
    .addIntegerOption(opt => opt.setName('amount').setDescription('削除する数').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('サーバー統計を表示します')
].map(cmd => cmd.toJSON());

// ====== Bot 起動時 ======
client.once('ready', async () => {
  console.log(`✅ ログイン完了: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log('✅ スラッシュコマンド登録完了');
});

// ====== メッセージ監視 ======
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // 禁止ワード検出
  for (const word of bannedWords) {
    if (message.content.includes(word)) {
      await message.delete().catch(() => {});
      warnings[message.author.id] = (warnings[message.author.id] || 0) + 1;
      fs.writeJsonSync(warningsPath, warnings, { spaces: 2 });

      const logChannel = client.channels.cache.get(process.env.LOG_CHANNEL_ID);
      if (logChannel) {
        logChannel.send(`🚫 ${message.author.tag} が禁止ワード「${word}」を使用しました。（警告 ${warnings[message.author.id]} 回）`);
      }

      if (warnings[message.author.id] >= 3) {
        await message.guild.members.ban(message.author.id).catch(() => {});
        logChannel?.send(`⛔ ${message.author.tag} を警告累積でBANしました。`);
      }
      return;
    }
  }

  // 招待リンク監視
  if (message.content.match(/(discord\.gg|discordapp\.com\/invite)/)) {
    await message.delete().catch(() => {});
    message.channel.send(`${message.author} 招待リンクは禁止されています。`).then(msg => {
      setTimeout(() => msg.delete().catch(() => {}), 5000);
    });
  }
});

// ====== スラッシュコマンド処理 ======
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ticket') {
    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: 0,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
      ]
    });
    await channel.send(`${interaction.user} さんのサポートチケットです。`);
    await interaction.reply({ content: `チケットを作成しました: ${channel}`, flags: 64 });
  }

  if (interaction.commandName === 'close') {
    if (interaction.channel.name.startsWith('ticket-')) {
      await interaction.reply('このチケットを閉じます...');
      setTimeout(() => interaction.channel.delete().catch(() => {}), 2000);
    } else {
      await interaction.reply({ content: 'ここはチケットチャンネルではありません。', flags: 64 });
    }
  }

  if (interaction.commandName === 'warn') {
    const target = interaction.options.getUser('target');
    warnings[target.id] = (warnings[target.id] || 0) + 1;
    fs.writeJsonSync(warningsPath, warnings, { spaces: 2 });
    await interaction.reply(`${target.tag} に警告を与えました。（合計 ${warnings[target.id]} 回）`);
  }

  if (interaction.commandName === 'warnings') {
    const target = interaction.options.getUser('target');
    const count = warnings[target.id] || 0;
    await interaction.reply(`${target.tag} の警告回数: ${count} 回`);
  }

  if (interaction.commandName === 'purge') {
    const amount = interaction.options.getInteger('amount');
    await interaction.channel.bulkDelete(amount, true);
    await interaction.reply({ content: `${amount} 件のメッセージを削除しました。`, flags: 64 });
  }

  if (interaction.commandName === 'stats') {
    const guild = interaction.guild;
    await interaction.reply(`📊 メンバー数: ${guild.memberCount}`);
  }
});

client.login(process.env.DISCORD_TOKEN);

