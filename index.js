import express from "express";
import TelegramBot from "node-telegram-bot-api";

const app = express();
const PORT = process.env.PORT || 3000;

// === TELEGRAM ===
const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error("❌ BOT_TOKEN não definido");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

bot.on("message", (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "🤖 Bot online com sucesso!");
});

// === EXPRESS (Railway precisa disso) ===
app.get("/", (req, res) => {
  res.send("🚀 Auto Analista Bac Bo rodando!");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
