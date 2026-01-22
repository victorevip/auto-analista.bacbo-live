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

// === BOT ===
const bot = new TelegramBot(TOKEN, { polling: true });

// ===== ESTADO =====
const emAnalise = {};
const historico = {};
const aguardandoResultado = {}; // 👈 NOVO
const aguardandoTipoWin = {};   // 👈 NOVO

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
  if (user.plano === "pago") return Date.now() < user.expira_em;

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

// ===== ESTRATÉGIA =====
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
  criarUsuarioDemo(msg.from.id);
  emAnalise[msg.from.id] = false;
  historico[msg.from.id] = [];

  bot.sendMessage(
    msg.chat.id,
    "🤖 *Auto Analista Bac Bo*\n\n▶️ Use /analisar para iniciar",
    { parse_mode: "Markdown" }
  );
});

// ===== ANALISAR =====
bot.onText(/\/analisar/, (msg) => {
  getUser(msg.from.id, (user) => {
    if (!user || !podeUsarBot(user)) {
      return bot.sendMessage(
        msg.chat.id,
        "⛔ Teste esgotado\n/pix 30\n/pix 90\n/pix 365"
      );
    }

    emAnalise[msg.from.id] = true;
    historico[msg.from.id] = [];

    bot.sendMessage(
      msg.chat.id,
      "📥 Envie os resultados:\n🔵 🔴 🟠"
    );
  });
});

// ===== RECEBE EMOJIS =====
bot.on("message", (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const id = msg.from.id;
  if (!emAnalise[id]) return;

  const letras = msg.text
    .split(/\s+/)
    .map(emojiParaLetra)
    .filter(Boolean);

  for (const letra of letras) {
    historico[id].push(letra);
    if (historico[id].length > 20) historico[id].shift();

    const sinal = analisarPOUP(historico[id]);

    if (sinal && sinal !== "NO_BET") {
      getUser(id, (u) => consumirEntrada(u));
      emAnalise[id] = false;
      aguardandoResultado[id] = true;

      return bot.sendMessage(
        msg.chat.id,
        `🚨 *OPORTUNIDADE DETECTADA* 🚨\n\n📊 Histórico:\n${historico[id].join(
          " "
        )}\n\n🎯 *ENTRADA CONFIRMADA:*\n${sinal}\n\n⏱ FAZER ATÉ G1`,
        {
          parse_mode: "Markdown",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ WIN", callback_data: "WIN" },
                { text: "❌ LOSS", callback_data: "LOSS" },
              ],
            ],
          },
        }
      );
    }
  }
});

// ===== CALLBACKS =====
bot.on("callback_query", (q) => {
  const id = q.from.id;

  if (q.data === "WIN" && aguardandoResultado[id]) {
    aguardandoResultado[id] = false;
    aguardandoTipoWin[id] = true;

    return bot.editMessageText(
      "Confirme o resultado:",
      {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🟢 WIN SEM GALE", callback_data: "WIN_SG" },
              { text: "🟢 WIN NO GALE 1", callback_data: "WIN_G1" },
            ],
          ],
        },
      }
    );
  }

  if (q.data === "LOSS" && aguardandoResultado[id]) {
    aguardandoResultado[id] = false;
    return bot.editMessageText("❌ LOSS registrado.", {
      chat_id: q.message.chat.id,
      message_id: q.message.message_id,
    });
  }

  if ((q.data === "WIN_SG" || q.data === "WIN_G1") && aguardandoTipoWin[id]) {
    aguardandoTipoWin[id] = false;
    return bot.editMessageText(
      q.data === "WIN_SG"
        ? "🟢 WIN SEM GALE registrado!"
        : "🟢 WIN NO GALE 1 registrado!",
      {
        chat_id: q.message.chat.id,
        message_id: q.message.message_id,
      }
    );
  }
});

// === EXPRESS ===
app.get("/", (_, res) => res.send("🚀 Bot rodando"));

app.listen(PORT, () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
);
