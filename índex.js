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

// === BOT ===
const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  const agora = Date.now();

  db.run(
    `
    INSERT INTO users (telegram_id, criado_em)
    VALUES (?, ?)
    ON CONFLICT(telegram_id) DO NOTHING
  `,
    [chatId.toString(), agora]
  );

  bot.sendMessage(
    chatId,
    "🤖 Bot online com sucesso!\n\n🎯 Plano DEMO: 1 entrada por dia"
  );
});

// === EXPRESS (Railway exige isso) ===
app.get("/", (req, res) => {
  res.send("🚀 Auto Analista Bac Bo rodando!");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
