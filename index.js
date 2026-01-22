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

// ===== ESTADO =====
const emAnalise = {};
const historico = {};

// ===== FUNÇÕES =====
function hoje() {
  return Math.floor(Date.now() / 86400000);
}

function getUser(id, cb) {
  db.get("SELECT * FROM users WHERE telegram_id = ?", [id], (_, r) =>
    cb(r || null)
  );
}

function criarUsuarioDemo(id) {
  db.run(
    `INSERT OR IGNORE INTO users 
     (telegram_id, plano, criado_em, ultimo_dia, entradas_hoje)
     VALUES (?, 'demo', ?, ?, 0)`,
    [id, Date.now(), hoje()]
  );
}

function podeUsarBot(user) {
  if (!user) return false;

  if (user.plano === "pago") {
    return Date.now() < user.expira_em;
  }

  const dia = hoje();
  if (user.ultimo_dia !== dia) {
    db.run(
      "UPDATE users SET entradas_hoje=0, ultimo_dia=? WHERE telegram_id=?",
      [dia, user.telegram_id]
    );
    return true;
  }

  return user.entradas_hoje < 1;
}

function consumirEntrada(user) {
  db.run(
    "UPDATE users SET entradas_hoje = entradas_hoje + 1 WHERE telegram_id=?",
    [user.telegram_id]
  );
}

// ===== EMOJI =====
function emojiParaLetra(e) {
  if (e === "🔵") return "P";
  if (e === "🔴") return "B";
  if (e === "🟠") return "E";
  return null;
}

// ===== ESTRATÉGIA POUP =====
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
  const pP = score.P / total;
  const pB = score.B / total;
  const pE = score.E / total;

  if (pE > 0.2) return "NO_BET";

  let last = w[w.length - 1];
  let streak = 1;
  for (let i = w.length - 2; i >= 0; i--) {
    if (w[i] === last) streak++;
    else break;
  }

  if (streak >= 3) {
    return last === "P" ? "🔴 VERMELHO" : "🔵 AZUL";
  }

  if (pP > 0.6) return "🔵 AZUL";
  if (pB > 0.6) return "🔴 VERMELHO";

  return "NO_BET";
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  criarUsuarioDemo(msg.from.id);
  emAnalise[msg.from.id] = false;
  historico[msg.from.id] = [];

  bot.sendMessage(
    msg.chat.id,
    "🤖 *Auto Analista Bac Bo*\n\n🎯 Plano DEMO ativo\n📌 1 teste grátis por dia\n\n▶️ Use /analisar para iniciar\n💳 Planos:\n/pix 30\n/pix 90\n/pix 365",
    { parse_mode: "Markdown" }
  );
});

// ===== ANALISAR =====
bot.onText(/\/analisar/, (msg) => {
  getUser(msg.from.id, (user) => {
    if (!user || !podeUsarBot(user)) {
      return bot.sendMessage(
        msg.chat.id,
        "⛔ *Teste grátis esgotado*\n\n💳 Adquira um plano:\n/pix 30\n/pix 90\n/pix 365",
        { parse_mode: "Markdown" }
      );
    }

    emAnalise[msg.from.id] = true;
    historico[msg.from.id] = [];

    bot.sendMessage(
      msg.chat.id,
      "📥 *Análise iniciada*\nEnvie os resultados:\n🔵 🔴 🟠",
      { parse_mode: "Markdown" }
    );
  });
});

// ===== RECEBE EMOJIS =====
bot.on("message", (msg) => {
  if (!msg.text) return;
  if (msg.text.startsWith("/")) return;

  const id = msg.from.id;
  if (!emAnalise[id]) return;

  const letra = emojiParaLetra(msg.text.trim());
  if (!letra) return;

  historico[id].push(letra);
  if (historico[id].length > 20) historico[id].shift();

  const sinal = analisarPOUP(historico[id]);

  if (!sinal) {
    return bot.sendMessage(
      msg.chat.id,
      `📊 Histórico:\n${historico[id].join(" ")}\n\n⏳ Aguardando dados suficientes...`
    );
  }

  if (sinal === "NO_BET") {
    return bot.sendMessage(
      msg.chat.id,
      `📊 Histórico:\n${historico[id].join(
        " "
      )}\n\n⚪ NO BET — aguardando oportunidade...`
    );
  }

  // 🚨 OPORTUNIDADE REAL → CONSOME TESTE
  getUser(id, (user) => consumirEntrada(user));
  emAnalise[id] = false;

  bot.sendMessage(
    msg.chat.id,
    `🚨 *OPORTUNIDADE DETECTADA* 🚨\n\n📊 Histórico:\n${historico[id].join(
      " "
    )}\n\n🎯 *ENTRADA CONFIRMADA:*\n${sinal}\n\n⏰ Aja na próxima rodada!`,
    { parse_mode: "Markdown" }
  );
});

// === EXPRESS ===
app.get("/", (_, res) => res.send("🚀 Auto Analista Bac Bo rodando!"));

app.listen(PORT, () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
);
