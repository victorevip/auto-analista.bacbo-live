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

if (!TOKEN) {
  console.error("❌ Nenhum token do Telegram definido");
  process.exit(1);
}

// === BOT ===
const bot = new TelegramBot(TOKEN, { polling: true });

// === ADMIN ===
const ADMIN_ID = 8429920060;

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

/* 🔁 FUNÇÃO FINAL */
function podeUsarBot(user) {
  if (!user) return false;

  // PLANO PAGO
  if (user.plano === "pago") {
    if (!user.expira_em) return true;
    return Date.now() < user.expira_em;
  }

  // PLANO DEMO (1 entrada/dia)
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

// ===== COMANDOS LIBERADOS =====
bot.onText(/\/start/, (msg) => {
  criarUsuarioDemo(msg.from.id);

  bot.sendMessage(
    msg.chat.id,
    "🤖 *Auto Analista Bac Bo*\n\n🎯 Plano DEMO ativo\n📌 1 entrada por dia",
    { parse_mode: "Markdown" }
  );
});

/* 🧾 STATUS */
bot.onText(/\/status/, (msg) => {
  getUser(msg.from.id, (user) => {
    if (!user) return bot.sendMessage(msg.chat.id, "Use /start primeiro.");

    let texto = `🧾 *STATUS*\nPlano: ${user.plano.toUpperCase()}`;

    if (user.plano === "demo") {
      texto += `\nEntradas hoje: ${user.entradas_hoje}/1`;
    }

    if (user.plano === "pago" && user.expira_em) {
      texto += `\nExpira em: ${new Date(user.expira_em).toLocaleDateString()}`;
    }

    bot.sendMessage(msg.chat.id, texto, { parse_mode: "Markdown" });
  });
});

/* 🔐 ADMIN - ATIVAR PLANO */
bot.onText(/\/ativar (\d+) (\d+)/, (msg, match) => {
  if (msg.from.id !== ADMIN_ID) {
    return bot.sendMessage(msg.chat.id, "⛔ Acesso negado");
  }

  const telegramId = match[1];
  const dias = parseInt(match[2]);
  const expira = Date.now() + dias * 86400000;

  db.run(
    `
    UPDATE users 
    SET plano = 'pago', expira_em = ?
    WHERE telegram_id = ?
    `,
    [expira, telegramId]
  );

  bot.sendMessage(
    msg.chat.id,
    `✅ Plano PAGO ativado\n👤 Usuário: ${telegramId}\n⏳ ${dias} dias`
  );
});

// ===== BLOQUEIO TOTAL (mensagens + comandos) =====
bot.on("message", (msg) => {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  // libera admin
  if (telegramId === ADMIN_ID) return;

  // libera /start e /status
  if (msg.text.startsWith("/start") || msg.text.startsWith("/status")) return;

  getUser(telegramId, (user) => {
    if (!user) {
      criarUsuarioDemo(telegramId);
      return bot.sendMessage(chatId, "Use /start para iniciar.");
    }

    if (!podeUsarBot(user)) {
      return bot.sendMessage(
        chatId,
        "⛔ *Acesso bloqueado*\n\n📌 Plano DEMO: 1 entrada/dia\n🔓 Adquira o plano pago.",
        { parse_mode: "Markdown" }
      );
    }

    registrarEntrada(user);

    bot.sendMessage(
      chatId,
      "📊 *Análise enviada com sucesso!*",
      { parse_mode: "Markdown" }
    );
  });
});

// === EXPRESS ===
app.get("/", (req, res) => {
  res.send("🚀 Auto Analista Bac Bo rodando!");
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando na porta ${PORT}`);
});
