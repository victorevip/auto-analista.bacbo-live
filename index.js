import express from "express";
import TelegramBot from "node-telegram-bot-api";
import mercadopago from "mercadopago";
import { db } from "./database.js";

console.log("🚀 Iniciando aplicação...");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// === ADMIN ID ===
const ADMIN_ID = 8429920060;

// === TELEGRAM TOKEN ===
const TOKEN =
  process.env.BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.AUTO_BACBO_TOKEN;

if (!TOKEN) {
  console.error("❌ Nenhum token do Telegram definido");
  process.exit(1);
}

// === MERCADO PAGO ===
if (!process.env.MP_ACCESS_TOKEN) {
  console.error("❌ MP_ACCESS_TOKEN não definido");
  process.exit(1);
}

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// === BOT ===
const bot = new TelegramBot(TOKEN, { polling: true });

// ===== ESTADO =====
const emAnalise = {};
const historico = {};

// ===== FUNÇÕES =====
function hoje() {
  return Math.floor(Date.now() / 86400000);
}

function isAdmin(msg) {
  return msg.from.id === ADMIN_ID;
}

function getUser(id, cb) {
  db.get(
    "SELECT * FROM users WHERE telegram_id = ?",
    [id],
    (_, r) => cb(r || null)
  );
}

function criarUsuarioDemo(id) {
  db.run(
    `
    INSERT OR IGNORE INTO users 
    (telegram_id, plano, criado_em, ultimo_dia, entradas_hoje)
    VALUES (?, 'demo', ?, ?, 0)
    `,
    [id, Date.now(), hoje()]
  );
}

function podeUsarBot(user) {
  if (!user) return false;
  if (user.plano === "pago") return Date.now() < user.expira_em;

  const dia = hoje();
  if (user.ultimo_dia !== dia) {
    db.run(
      "UPDATE users SET entradas_hoje = 0, ultimo_dia = ? WHERE telegram_id = ?",
      [dia, user.telegram_id]
    );
    return true;
  }
  return user.entradas_hoje < 1;
}

function consumirEntrada(user) {
  db.run(
    "UPDATE users SET entradas_hoje = entradas_hoje + 1 WHERE telegram_id = ?",
    [user.telegram_id]
  );
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  if (!isAdmin(msg))
    return bot.sendMessage(msg.chat.id, "⛔ Acesso restrito ao administrador.");

  criarUsuarioDemo(msg.from.id);
  emAnalise[msg.from.id] = false;
  historico[msg.from.id] = [];

  bot.sendMessage(
    msg.chat.id,
    "🤖 *Auto Analista Bac Bo*\n\n🔓 Acesso ADMIN liberado",
    { parse_mode: "Markdown" }
  );
});

// ===== STATUS =====
bot.onText(/\/status/, (msg) => {
  if (!isAdmin(msg))
    return bot.sendMessage(msg.chat.id, "⛔ Acesso restrito ao administrador.");

  getUser(msg.from.id, (user) => {
    if (!user) return;
    bot.sendMessage(
      msg.chat.id,
      `🧾 *STATUS*\nPlano: ${user.plano.toUpperCase()}`,
      { parse_mode: "Markdown" }
    );
  });
});

// ===== ANALISAR =====
bot.onText(/\/analisar/, (msg) => {
  if (!isAdmin(msg))
    return bot.sendMessage(msg.chat.id, "⛔ Acesso restrito ao administrador.");

  emAnalise[msg.from.id] = true;
  historico[msg.from.id] = [];

  bot.sendMessage(
    msg.chat.id,
    "📥 *Análise iniciada*\nEnvie os resultados:\n🔵 🔴 🟠",
    { parse_mode: "Markdown" }
  );
});

// ===== RECEBE RESULTADOS =====
bot.on("message", (msg) => {
  if (!isAdmin(msg)) return;
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!emAnalise[msg.from.id]) return;
});

// ===== PIX =====
bot.onText(/\/pix$/, (msg) => {
  if (!isAdmin(msg))
    return bot.sendMessage(msg.chat.id, "⛔ Acesso restrito ao administrador.");
});

// === EXPRESS ===
app.get("/", (_, res) => res.send("🚀 Bot rodando"));
app.listen(PORT, () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
);
