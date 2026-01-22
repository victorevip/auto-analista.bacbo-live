import express from "express";
import TelegramBot from "node-telegram-bot-api";
import mercadopago from "mercadopago";
import { db } from "./database.js";

console.log("🚀 Iniciando aplicação...");

const app = express();
app.use(express.json());

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

// ===== ESTADOS =====
const estadoAnalise = {};   // true / false
const historico = {};       // histórico por usuário

// ===== UTIL =====
function hoje() {
  return Math.floor(Date.now() / 86400000);
}

// ===== BANCO =====
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
    (telegram_id, plano, criado_em, ultimo_dia, entradas_hoje)
    VALUES (?, 'demo', ?, ?, 0)
    `,
    [telegramId, Date.now(), hoje()]
  );
}

function podeUsarBot(user) {
  if (!user) return false;

  if (user.plano === "pago") {
    return Date.now() < user.expira_em;
  }

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

// ===== CONVERSÃO EMOJI =====
function emojiParaLetra(t) {
  if (t === "🔵") return "P";
  if (t === "🔴") return "B";
  if (t === "🟠") return "E";
  return null;
}

// ===== ESTRATÉGIA POUP =====
function analisarPOUP(H) {
  if (H.length < 10) {
    return `📊 Dados insuficientes (${H.length}/10)`;
  }

  const w = H.slice(-10);
  let score = { P: 0, B: 0, E: 0 };
  let peso = 1;

  for (let i = w.length - 1; i >= 0; i--) {
    score[w[i]] += peso;
    peso += 0.2;
  }

  const total = score.P + score.B + score.E;
  const pP = score.P / total;
  const pB = score.B / total;
  const pE = score.E / total;

  if (pE > 0.2) return "🟠 NO BET (empate alto)";

  const last = w[w.length - 1];
  let streak = 1;
  for (let i = w.length - 2; i >= 0; i--) {
    if (w[i] === last) streak++;
    else break;
  }

  if (streak >= 3) {
    return `🔥 Quebra de streak → ${last === "P" ? "🔴 VERMELHO" : "🔵 AZUL"}`;
  }

  if (pP > 0.6) return `🔵 AZUL (${(pP * 100).toFixed(1)}%)`;
  if (pB > 0.6) return `🔴 VERMELHO (${(pB * 100).toFixed(1)}%)`;

  return "⚪ NO BET";
}

// ===== START COM BOTÃO =====
bot.onText(/\/start/, (msg) => {
  const id = msg.from.id;
  criarUsuarioDemo(id);

  estadoAnalise[id] = false;
  historico[id] = [];

  bot.sendMessage(
    msg.chat.id,
    "🤖 *Auto Analista Bac Bo*\n\n📥 Envie os resultados:\n🔵 Azul\n🔴 Vermelho\n🟠 Empate\n\n▶️ Clique para iniciar a análise",
    {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Iniciar Análise", callback_data: "iniciar_analise" }],
        ],
      },
    }
  );
});

// ===== BOTÃO CALLBACK (LICENÇA OBRIGATÓRIA) =====
bot.on("callback_query", (q) => {
  if (q.data !== "iniciar_analise") return;

  const id = q.from.id;
  const chatId = q.message.chat.id;

  getUser(id, (user) => {
    if (!user || !podeUsarBot(user)) {
      bot.answerCallbackQuery(q.id, {
        text: "⛔ Sem entradas disponíveis",
        show_alert: true,
      });

      return bot.sendMessage(
        chatId,
        "⛔ *Acesso bloqueado*\n\n💳 Para liberar:\n/pix 30\n/pix 90\n/pix 365",
        { parse_mode: "Markdown" }
      );
    }

    estadoAnalise[id] = true;
    historico[id] = [];

    bot.answerCallbackQuery(q.id);
    bot.sendMessage(
      chatId,
      "✅ *Análise iniciada!*\n\nEnvie:\n🔵 🔴 🟠",
      { parse_mode: "Markdown" }
    );
  });
});

// ===== CATALOGAÇÃO (CONSUME ENTRADA) =====
bot.on("message", (msg) => {
  if (!msg.text) return;

  const id = msg.from.id;
  const chatId = msg.chat.id;

  if (msg.text.startsWith("/")) return;
  if (!estadoAnalise[id]) return;

  const letra = emojiParaLetra(msg.text.trim());
  if (!letra) return;

  getUser(id, (user) => {
    if (!user || !podeUsarBot(user)) {
      estadoAnalise[id] = false;
      return bot.sendMessage(
        chatId,
        "⛔ *Entrada esgotada*\n\n💳 Para continuar:\n/pix 30\n/pix 90\n/pix 365",
        { parse_mode: "Markdown" }
      );
    }

    registrarEntrada(user);

    historico[id].push(letra);
    if (historico[id].length > 20) historico[id].shift();

    const sinal = analisarPOUP(historico[id]);

    bot.sendMessage(
      chatId,
      `📥 Histórico:\n${historico[id].join(" ")}\n\n🎯 *SINAL*\n${sinal}`,
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
