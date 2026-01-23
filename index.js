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

function emojiParaLetra(e) {
  if (e === "🔵") return "P";
  if (e === "🔴") return "B";
  if (e === "🟠") return "E";
  return null;
}

// ===== ESTRATÉGIA (POUP WebSim) =====
function analisarPOUP(H) {
  if (H.length < 10) return null;

  const w = H.slice(-10);
  let score = { P: 0, B: 0, E: 0 };
  let peso = 1;

  for (let i = w.length - 1; i >= 0; i--) {
    score[w[i]] += peso;
    peso += 0.2;
  }

  const total = score.P + score.B + score.E;

  if (score.E / total > 0.2) return "NO_BET";

  let last = w[w.length - 1];
  let streak = 1;
  for (let i = w.length - 2; i >= 0; i--) {
    if (w[i] === last) streak++;
    else break;
  }

  if (streak >= 3) return last === "P" ? "🔴 VERMELHO" : "🔵 AZUL";

  if (score.P / total > 0.6) return "🔵 AZUL";
  if (score.B / total > 0.6) return "🔴 VERMELHO";

  return "NO_BET";
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  if (!isAdmin(msg))
    return bot.sendMessage(msg.chat.id, "⛔ Acesso restrito ao administrador.");

  emAnalise[msg.from.id] = false;
  historico[msg.from.id] = [];

  bot.sendMessage(
    msg.chat.id,
    "🤖 *Auto Analista Bac Bo*\n\n🔓 Acesso ADMIN liberado\n▶️ Use /analisar",
    { parse_mode: "Markdown" }
  );
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

// ===== RECEBE RESULTADOS (REATIVADO) =====
bot.on("message", (msg) => {
  if (!isAdmin(msg)) return;
  if (!msg.text || msg.text.startsWith("/")) return;
  if (!emAnalise[msg.from.id]) return;

  const letra = emojiParaLetra(msg.text.trim());
  if (!letra) return;

  historico[msg.from.id].push(letra);
  if (historico[msg.from.id].length > 20)
    historico[msg.from.id].shift();

  const sinal = analisarPOUP(historico[msg.from.id]);

  if (!sinal || sinal === "NO_BET") {
    return bot.sendMessage(
      msg.chat.id,
      `📊 Histórico:\n${historico[msg.from.id].join(" ")}\n\n⏳ Aguardando oportunidade...`
    );
  }

  emAnalise[msg.from.id] = false;

  bot.sendMessage(
    msg.chat.id,
    `🚨 *OPORTUNIDADE DETECTADA* 🚨\n\n📊 Histórico:\n${historico[msg.from.id].join(
      " "
    )}\n\n🎯 *ENTRADA CONFIRMADA:*\n${sinal}`,
    { parse_mode: "Markdown" }
  );
});

// === EXPRESS ===
app.get("/", (_, res) => res.send("🚀 Bot rodando"));
app.listen(PORT, () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
);
