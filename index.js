const { 
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, 
  PermissionFlagsBits, EmbedBuilder 
} = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require('@discordjs/voice');
const play = require('play-dl');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// 保存ファイル
const warningFile = path.join(__dirname, 'warnings.json');
const activityFile = path.join(__dirname, 'activity.json');
const settingsFile = path.join(__dirname, 'channelSettings.json');

let warnings = fs.existsSync(warningFile) ? fs.readJsonSync(warningFile) : {};
let activity = fs.existsSync(activityFile) ? fs.readJsonSync(activityFile) : {};
let channelSettings = fs.existsSync(settingsFile) ? fs.readJsonSync(settingsFile) : {};

const saveWarnings = () => fs.writeJsonSync(warningFile, warnings, { spaces: 2 });
const saveActivity = () => fs.writeJsonSync(activityFile, activity, { spaces: 2 });
const saveSettings = () => fs.writeJsonSync(settingsFile, channelSettings, { spaces: 2 });

// スラッシュコマンド定義
const commands = [
  new SlashCommandBuilder().setName('warn').setDescription('ユーザーに警告を与える')
    .addUserOption(opt => opt.setName('target').setDescription('対象ユーザー').setRequired(true)),

  new SlashCommandBuilder().setName('warnings').setDescription('警告回数を確認する')
    .addUserOption(opt => opt.setName('target').setDescription('対象ユーザー').setRequired(true)),

  new SlashCommandBuilder().setName('clearwarnings').setDescription('警告をリセットする')
    .addUserOption(opt => opt.setName('target').setDescription('対象ユーザー').setRequired(true)),

  new SlashCommandBuilder().setName('ban').setDescription('ユーザーをBANする')
    .addUserOption(opt => opt.setName('target').setDescription('対象ユーザー').setRequired(true)),

  new SlashCommandBuilder().setName('kick').setDescription('ユーザーをKickする')
    .addUserOption(opt => opt.setName('target').setDescription('対象ユーザー').setRequired(true)),

  new SlashCommandBuilder().setName('ticket').setDescription('チケットを作成する'),

  new SlashCommandBuilder().setName('close').setDescription('チケットを閉じる'),

  new SlashCommandBuilder().setName('dice').setDescription('サイコロを振る'),

  new SlashCommandBuilder().setName('quiz').setDescription('クイズを出題する'),

  new SlashCommandBuilder().setName('play').setDescription('音楽を再生する(botが落ちてしまうので非推奨)')
    .addStringOption(opt => opt.setName('query').setDescription('URLまたは検索ワード').setRequired(true)),

  new SlashCommandBuilder().setName('ranking').setDescription('発言数ランキングを表示する'),

  // 監視設定
  new SlashCommandBuilder().setName('setlinkban').setDescription('リンク禁止チャンネルを設定')
    .addChannelOption(opt => opt.setName('channel').setDescription('対象チャンネル').setRequired(true)),

  new SlashCommandBuilder().setName('setimageonly').setDescription('画像専用チャンネルを設定')
    .addChannelOption(opt => opt.setName('channel').setDescription('対象チャンネル').setRequired(true)),

  new SlashCommandBuilder().setName('unsetchannel').setDescription('監視設定を解除')
    .addChannelOption(opt => opt.setName('channel').setDescription('対象チャンネル').setRequired(true))
].map(cmd => cmd.toJSON());

// 起動時
client.once('ready', async () => {
  console.log(`✅ ログイン完了: ${client.user.tag}`);
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
  console.log('✅ スラッシュコマンド登録完了');
});

// 📊 発言数カウント（ランキング用）
client.on('messageCreate', msg => {
  if (msg.author.bot) return;

  // アクティビティ記録
  if (!activity[msg.author.id]) activity[msg.author.id] = 0;
  activity[msg.author.id]++;
  saveActivity();

  // 🔎 メッセージ監視
  const set = channelSettings[msg.channel.id];
  if (set === 'linkban' && /(https?:\/\/)/.test(msg.content)) {
    msg.delete().catch(() => {});
    msg.channel.send(`${msg.author}, このチャンネルではリンクは禁止です！`).then(m => setTimeout(() => m.delete(), 5000));
  }
  if (set === 'imageonly' && msg.attachments.size === 0) {
    msg.delete().catch(() => {});
    msg.channel.send(`${msg.author}, このチャンネルは画像専用です！`).then(m => setTimeout(() => m.delete(), 5000));
  }
  if (msg.attachments.size > 0) {
    for (const att of msg.attachments.values()) {
      if (att.name.endsWith('.exe') || att.name.endsWith('.bat') || att.name.endsWith('.zip')) {
        msg.delete().catch(() => {});
        msg.channel.send(`${msg.author}, 危険なファイルは送信できません！`).then(m => setTimeout(() => m.delete(), 5000));
      }
    }
  }
});

// コマンド処理
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // 🎲 サイコロ
  if (interaction.commandName === 'dice') {
    const roll = Math.floor(Math.random() * 6) + 1;
    await interaction.reply(`🎲 サイコロの目は **${roll}** です！`);
  }

  // ❓ クイズ
  if (interaction.commandName === 'quiz') {
    const quiz = { q: '日本の首都は？', a: '東京' };
    await interaction.reply(`❓ クイズ: **${quiz.q}**`);
    const collector = interaction.channel.createMessageCollector({ time: 15000 });
    collector.on('collect', m => {
      if (m.content.trim() === quiz.a) {
        m.reply(`🎉 正解！ ${m.author}`);
        collector.stop();
      }
    });
  }

  // 🎵 音楽
  if (interaction.commandName === 'play') {
    const query = interaction.options.getString('query');
    const channel = interaction.member.voice.channel;
    if (!channel) return interaction.reply('❌ VCに入ってください');

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator
    });

    let info;
    if (play.yt_validate(query) === 'video') {
      info = await play.video_info(query);
    } else {
      const searched = await play.search(query, { limit: 1 });
      if (!searched.length) return interaction.reply('見つかりませんでした');
      info = await play.video_info(searched[0].url);
    }

    const stream = await play.stream(info.video_details.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    const player = createAudioPlayer();
    player.play(resource);
    connection.subscribe(player);

    await interaction.reply(`🎵 再生中: **${info.video_details.title}**`);
  }

  // 🏆 ランキング
  if (interaction.commandName === 'ranking') {
    const sorted = Object.entries(activity).sort((a, b) => b[1] - a[1]).slice(0, 10);
    let desc = sorted.map(([id, count], i) => {
      const user = interaction.guild.members.cache.get(id);
      return `**${i+1}.** ${user ? user.user.tag : id} - ${count}メッセージ`;
    }).join('\n');
    const embed = new EmbedBuilder().setTitle('🏆 アクティビティランキング').setDescription(desc).setColor('Gold');
    await interaction.reply({ embeds: [embed] });
  }

  // 🔒 監視設定
  if (interaction.commandName === 'setlinkban') {
    const ch = interaction.options.getChannel('channel');
    channelSettings[ch.id] = 'linkban';
    saveSettings();
    await interaction.reply(`🔒 ${ch} をリンク禁止に設定しました`);
  }

  if (interaction.commandName === 'setimageonly') {
    const ch = interaction.options.getChannel('channel');
    channelSettings[ch.id] = 'imageonly';
    saveSettings();
    await interaction.reply(`🖼️ ${ch} を画像専用に設定しました`);
  }

  if (interaction.commandName === 'unsetchannel') {
    const ch = interaction.options.getChannel('channel');
    delete channelSettings[ch.id];
    saveSettings();
    await interaction.reply(`✅ ${ch} の監視設定を解除しました`);
  }
});

client.login(process.env.DISCORD_TOKEN);
