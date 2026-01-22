import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { db } from "./database.js";

const app = express();
const PORT = process.env.PORT || 3000;

// === TOKEN DO TELEGRAM ===
const TOKEN =
  process.env.BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.AUTO_BACBO_TOKEN;

if (!TOKEN) {
  console.error("❌ Nenhum token do Telegram definido");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

bot.on("message", (msg) => {
  const chatId = msg.chat.id;

  db.run(
    `INSERT OR IGNORE INTO users (telegram_id, plano, criado_em)
     VALUES (?, ?, ?)`,
    [chatId.toString(), "demo", Date.now()]
  );

  bot.sendMessage(chatId, "🤖 Bot online com sucesso!");
});

// === EXPRESS (Railway exige isso) ===
app.get("/", (req, res) => {
  res.send("🚀 Auto Analista Bac Bo rodando!");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
