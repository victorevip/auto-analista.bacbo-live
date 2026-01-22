import express from "express";
import TelegramBot from "node-telegram-bot-api";
import { db } from "./database.js";

console.log("🚀 Iniciando aplicação...");

const app = express();
const PORT = process.env.PORT || 3000;

// === TELEGRAM TOKEN ===
const TOKEN =
  process.env.BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.AUTO_BACBO_TOKEN;

console.log("🔑 TOKEN existe?", !!TOKEN);

if (!TOKEN) {
  console.error("❌ Nenhum token do Telegram definido");
  process.exit(1);
}

console.log("✅ Token carregado");

// === BOT ===
const bot = new TelegramBot(TOKEN, { polling: true });

bot.on("message", (msg) => {
  bot.sendMessage(msg.chat.id, "🤖 Bot online com sucesso!");
});

console.log("🤖 Bot iniciado");

// === EXPRESS ===
app.get("/", (req, res) => {
  res.send("🚀 Auto Analista Bac Bo rodando!");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
