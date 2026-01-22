import express from "express";
import TelegramBot from "node-telegram-bot-api";
import db from "./database.js";

const app = express();
const PORT = process.env.PORT || 3000;

// === TELEGRAM TOKEN ===
const TOKEN =
  process.env.BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.AUTO_BACBO_TOKEN;

if (!TOKEN) {
  console.error("❌ Nenhum token do Telegram definido");
  process.exit(1);
}

const bot = new TelegramBot(TOKEN, { polling: true });

// ==============================
// FUNÇÕES AUXILIARES
// ==============================
function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function getUser(telegramId) {
  return db
    .prepare("SELECT * FROM users WHERE telegram_id = ?")
    .get(String(telegramId));
}

function createUser(telegramId) {
  db.prepare(
    "INSERT INTO users (telegram_id) VALUES (?)"
  ).run(String(telegramId));
}

function canUseDemo(user) {
  const today = getToday();

  if (user.last_entry_date !== today) {
    db.prepare(`
      UPDATE users
      SET last_entry_date = ?, entries_today = 0
      WHERE telegram_id = ?
    `).run(today, user.telegram_id);

    user.entries_today = 0;
  }

  return user.entries_today < 1; // 🔒 1 entrada por dia
}

function registerEntry(user) {
  db.prepare(`
    UPDATE users
    SET entries_today = entries_today + 1
    WHERE telegram_id = ?
  `).run(user.telegram_id);
}

// ==============================
// TELEGRAM
// ==============================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  let user = getUser(chatId);
  if (!user) {
    createUser(chatId);
    user = getUser(chatId);
  }

  bot.sendMessage(
    chatId,
    `🤖 *Auto Analista Bac Bo*\n\nPlano: ${user.plan.toUpperCase()}\n\nUse /entrada para testar`,
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/entrada/, (msg) => {
  const chatId = msg.chat.id;
  let user = getUser(chatId);

  if (!user) {
    bot.sendMessage(chatId, "❌ Use /start primeiro");
    return;
  }

  if (user.plan === "demo") {
    if (!canUseDemo(user)) {
      bot.sendMessage(
        chatId,
        "⛔ Plano DEMO permite apenas *1 entrada por dia*.\n\nFaça upgrade para ilimitado.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    registerEntry(user);

    bot.sendMessage(
      chatId,
      "🎯 *SINAL DEMO*\n\nAZUL 🔵\n\n(entrada demo registrada)",
      { parse_mode: "Markdown" }
    );

    return;
  }

  // Futuro: planos pagos
  bot.sendMessage(chatId, "🎯 SINAL PREMIUM");
});

// ==============================
// EXPRESS (Railway)
// ==============================
app.get("/", (req, res) => {
  res.send("🚀 Auto Analista Bac Bo rodando!");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
