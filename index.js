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

// ===== FUNÇÕES =====
function hoje() {
  return Math.floor(Date.now() / 86400000);
}

function getUser(telegramId, callback) {
  db.get(
    "SELECT * FROM users WHERE telegram_id = ?",
    [telegramId],
    (err, row) => callback(row || null)
  );
}

function criarUsuarioDemo(telegramId) {
  db.run(
    `
    INSERT OR IGNORE INTO users 
    (telegram_id, plano, criado_em, ultimo_dia)
    VALUES (?, 'demo', ?, ?)
    `,
    [telegramId, Date.now(), hoje()]
  );
}

function podeUsarBot(user) {
  if (user.plano === "pago") return true;

  if (user.plano === "demo") {
    const diaAtual = hoje();

    if (user.ultimo_dia !== diaAtual) {
      db.run(
        "UPDATE users SET entradas_hoje = 0, ultimo_dia = ? WHERE telegram_id = ?",
        [diaAtual, user.telegram_id]
      );
      return true;
    }

    return user.entradas_hoje < 1;
  }

  return false;
}

function registrarEntrada(user) {
  db.run(
    "UPDATE users SET entradas_hoje = entradas_hoje + 1 WHERE telegram_id = ?",
    [user.telegram_id]
  );
}

// ===== COMANDOS =====
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  criarUsuarioDemo(telegramId);

  bot.sendMessage(
    chatId,
    "🤖 *Auto Analista Bac Bo*\n\n🎯 Plano DEMO ativo\n📌 1 entrada por dia",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/plano/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  getUser(telegramId, (user) => {
    if (!user) return bot.sendMessage(chatId, "Use /start primeiro.");

    bot.sendMessage(
      chatId,
      `📦 *Seu plano:* ${user.plano.toUpperCase()}\n📊 Entradas hoje: ${user.entradas_hoje}`,
      { parse_mode: "Markdown" }
    );
  });
});

bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  getUser(telegramId, (user) => {
    if (!user) return bot.sendMessage(chatId, "Usuário não encontrado.");

    bot.sendMessage(
      chatId,
      `🧾 *STATUS*\nPlano: ${user.plano}\nEntradas hoje: ${user.entradas_hoje}`,
      { parse_mode: "Markdown" }
    );
  });
});

// ===== MENSAGEM NORMAL =====
bot.on("message", (msg) => {
  if (msg.text.startsWith("/")) return;

  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  getUser(telegramId, (user) => {
    if (!user) {
      criarUsuarioDemo(telegramId);
      return bot.sendMessage(chatId, "👋 Use /start para começar.");
    }

    if (!podeUsarBot(user)) {
      return bot.sendMessage(
        chatId,
        "⛔ Limite diário do plano DEMO atingido.\n🔓 Adquira o plano pago."
      );
    }

    registrarEntrada(user);

    bot.sendMessage(chatId, "📊 *Análise enviada com sucesso!*", {
      parse_mode: "Markdown",
    });
  });
});

console.log("🤖 Bot iniciado");

// === EXPRESS (Railway mantém online) ===
app.get("/", (req, res) => {
  res.send("🚀 Auto Analista Bac Bo rodando!");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
