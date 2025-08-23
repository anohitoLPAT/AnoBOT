require("dotenv").config();
const express = require("express");
const { Client, GatewayIntentBits, Partials, Events, PermissionsBitField, Collection } = require("discord.js");
const fs = require("fs-extra");
const path = require("path");
const play = require("play-dl");

// --- HTTP keep-alive ---
const app = express();
const PORT = process.env.PORT || 3000;
app.get("/", (_req, res) => res.send("OK"));
app.get("/health", (_req, res) => res.json({ ok: true, ts: Date.now() }));
app.listen(PORT, () => console.log(`[web] listening on :${PORT}`));

// --- Bot クライアント ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates
  ],
  partials: [Partials.Channel]
});

// --- データ保存用 ---
const dataDir = path.join(__dirname, "data");
fs.ensureDirSync(dataDir);
const logFile = path.join(dataDir, "settings.json");
const xpFile = path.join(dataDir, "xp.json");
const warnFile = path.join(dataDir, "warnings.json");
const bannedWordsFile = path.join(dataDir, "banned.json");
const quizFile = path.join(dataDir, "quiz.json");

let settings = fs.readJsonSync(logFile, { throws: false }) || { logChannel: null };
let xp = fs.readJsonSync(xpFile, { throws: false }) || {};
let warnings = fs.readJsonSync(warnFile, { throws: false }) || {};
let bannedWords = fs.readJsonSync(bannedWordsFile, { throws: false }) || [];
let quizzes = fs.readJsonSync(quizFile, { throws: false }) || [];

// --- ヘルパー保存関数 ---
function saveAll() {
  fs.writeJsonSync(logFile, settings);
  fs.writeJsonSync(xpFile, xp);
  fs.writeJsonSync(warnFile, warnings);
  fs.writeJsonSync(bannedWordsFile, bannedWords);
  fs.writeJsonSync(quizFile, quizzes);
}

// --- Bot Ready ---
client.once(Events.ClientReady, (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}`);
});

// --- コマンド処理 ---
client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  const prefix = "!";
  if (!msg.content.startsWith(prefix)) return;
  const args = msg.content.slice(prefix.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();

  // ========== 管理機能 ==========
  if (cmd === "setlog") {
    if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return msg.reply("管理者権限が必要です。");
    settings.logChannel = msg.channel.id;
    saveAll();
    msg.reply("✅ ログチャンネルを設定しました。");
  }

  if (cmd === "banword") {
    const word = args[0];
    if (!word) return msg.reply("禁止ワードを指定してください。");
    bannedWords.push(word.toLowerCase());
    saveAll();
    msg.reply(`🚫 禁止ワード「${word}」を追加しました。`);
  }

  if (cmd === "delbanword") {
    const word = args[0];
    bannedWords = bannedWords.filter((w) => w !== word.toLowerCase());
    saveAll();
    msg.reply(`✅ 「${word}」を禁止リストから削除しました。`);
  }

  if (cmd === "listbanwords") {
    msg.reply(`📜 禁止ワード: ${bannedWords.join(", ") || "なし"}`);
  }

  if (cmd === "kickall") {
    if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return msg.reply("管理者権限が必要です。");
    msg.guild.members.fetch().then((members) => {
      members.forEach((m) => {
        if (!m.user.bot && m.kickable) m.kick("一括Kick");
      });
    });
    msg.reply("⚡ 一括Kickを実行しました。");
  }

  if (cmd === "banall") {
    if (!msg.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return msg.reply("管理者権限が必要です。");
    msg.guild.members.fetch().then((members) => {
      members.forEach((m) => {
        if (!m.user.bot && m.bannable) m.ban({ reason: "一括BAN" });
      });
    });
    msg.reply("⚡ 一括BANを実行しました。");
  }

  if (cmd === "stats") {
    msg.reply(`👥 サーバーメンバー数: ${msg.guild.memberCount}`);
  }

  if (cmd === "poll") {
    const question = args.join(" ");
    if (!question) return msg.reply("投票内容を入力してください。");
    const pollMsg = await msg.channel.send(`📊 **投票:** ${question}`);
    await pollMsg.react("👍");
    await pollMsg.react("👎");
  }

  // ========== 遊び機能 ==========
  if (cmd === "dice") {
    const roll = Math.floor(Math.random() * 6) + 1;
    msg.reply(`🎲 サイコロの目: **${roll}**`);
  }

  if (cmd === "quizadd") {
    const q = args.join(" ");
    if (!q.includes("|")) return msg.reply("フォーマット: !quizadd 問題|答え");
    const [question, answer] = q.split("|");
    quizzes.push({ question, answer });
    saveAll();
    msg.reply("✅ クイズを追加しました。");
  }

  if (cmd === "quiz") {
    if (quizzes.length === 0) return msg.reply("クイズが登録されていません。");
    const quiz = quizzes[Math.floor(Math.random() * quizzes.length)];
    msg.channel.send(`❓ 問題: ${quiz.question}`);
    const filter = (m) => !m.author.bot;
    const collector = msg.channel.createMessageCollector({ filter, time: 15000 });
    collector.on("collect", (m) => {
      if (m.content.toLowerCase() === quiz.answer.toLowerCase()) {
        m.reply("🎉 正解！");
        collector.stop();
      }
    });
    collector.on("end", () => msg.channel.send("⏰ 時間切れ！"));
  }

  // ========== 音楽再生 ==========
  if (cmd === "play") {
    const vc = msg.member.voice.channel;
    if (!vc) return msg.reply("ボイスチャンネルに入ってください。");
    const query = args.join(" ");
    if (!query) return msg.reply("URLまたは検索ワードを入力してください。");

    const ytInfo = await play.search(query, { limit: 1 });
    if (!ytInfo[0]) return msg.reply("曲が見つかりませんでした。");

    const { joinVoiceChannel, createAudioPlayer, createAudioResource } = require("@discordjs/voice");
    const connection = joinVoiceChannel({
      channelId: vc.id,
      guildId: msg.guild.id,
      adapterCreator: msg.guild.voiceAdapterCreator
    });
    const stream = await play.stream(ytInfo[0].url);
    const player = createAudioPlayer();
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    player.play(resource);
    connection.subscribe(player);

    msg.reply(`🎶 再生中: ${ytInfo[0].title}`);
  }
});

// --- 禁止ワード監視 ---
client.on(Events.MessageCreate, (msg) => {
  if (msg.author.bot) return;
  if (bannedWords.some((w) => msg.content.toLowerCase().includes(w))) {
    msg.delete().catch(() => {});
    warnings[msg.author.id] = (warnings[msg.author.id] || 0) + 1;
    saveAll();
    msg.channel.send(`${msg.author}, 🚫 禁止ワードです！（警告${warnings[msg.author.id]}回目）`);
    if (warnings[msg.author.id] >= 3) {
      msg.member.ban({ reason: "禁止ワード累積" }).catch(() => {});
      msg.channel.send(`⛔ ${msg.author.tag} をBANしました。`);
    }
  }
});

// --- XP / ランキング ---
client.on(Events.MessageCreate, (msg) => {
  if (msg.author.bot) return;
  xp[msg.author.id] = (xp[msg.author.id] || 0) + 1;
  saveAll();
});

client.on(Events.MessageCreate, (msg) => {
  if (msg.content === "!rank") {
    const sorted = Object.entries(xp).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5).map(([id, score], i) => `${i + 1}. <@${id}> - ${score}xp`);
    msg.channel.send("🏆 **ランキング**\n" + top.join("\n"));
  }
});

client.login(process.env.DISCORD_TOKEN);
