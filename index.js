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

  if (user.plano === "pago") {
    return Date.now() < user.expira_em;
  }

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

// ===== EMOJI =====
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

  // filtro de empate
  if (score.E / total > 0.2) return "NO_BET";

  // streak
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
    "🤖 *Auto Analista Bac Bo*\n\n🎯 Plano DEMO ativo\n⏱️ Teste liberado por 24 horas\n\n▶️ Use /analisar\n💳 Plano mensal:\n/pix",
    { parse_mode: "Markdown" }
  );
});

// ===== STATUS =====
bot.onText(/\/status/, (msg) => {
  getUser(msg.from.id, (user) => {
    if (!user) return;

    let texto = `🧾 *STATUS*\nPlano: ${user.plano.toUpperCase()}`;

    if (user.plano === "demo") {
      texto += `\nEntradas hoje: ${user.entradas_hoje}/1`;
    }

    if (user.plano === "pago") {
      texto += `\nExpira em: ${new Date(user.expira_em).toLocaleDateString()}`;
    }

    bot.sendMessage(msg.chat.id, texto, { parse_mode: "Markdown" });
  });
});

// ===== ANALISAR =====
bot.onText(/\/analisar/, (msg) => {
  getUser(msg.from.id, (user) => {
    if (!user || !podeUsarBot(user)) {
      return bot.sendMessage(
        msg.chat.id,
        "⛔ *Teste grátis esgotado*\n\n💳 Plano mensal:\n/pix",
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

// ===== RECEBE RESULTADOS =====
bot.on("message", (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;

  const id = msg.from.id;
  if (!emAnalise[id]) return;

  const letra = emojiParaLetra(msg.text.trim());
  if (!letra) return;

  historico[id].push(letra);
  if (historico[id].length > 20) historico[id].shift();

  const sinal = analisarPOUP(historico[id]);

  if (!sinal || sinal === "NO_BET") {
    return bot.sendMessage(
      msg.chat.id,
      `📊 Histórico:\n${historico[id].join(" ")}\n\n⏳ Aguardando oportunidade...`
    );
  }

  getUser(id, (user) => consumirEntrada(user));
  emAnalise[id] = false;

  bot.sendMessage(
    msg.chat.id,
    `🚨 *OPORTUNIDADE DETECTADA* 🚨\n\n📊 Histórico:\n${historico[id].join(
      " "
    )}\n\n🎯 *ENTRADA CONFIRMADA:*\n${sinal}`,
    { parse_mode: "Markdown" }
  );
});

// ===== PIX =====
bot.onText(/\/pix$/, async (msg) => {
  try {
    const pagamento = await mercadopago.payment.create({
      transaction_amount: 59.9,
      description: "Plano Mensal - 30 dias",
      payment_method_id: "pix",
      payer: { email: `user${msg.from.id}@bot.com` },
      metadata: { telegram_id: msg.from.id },
    });

    const qr =
      pagamento.body.point_of_interaction.transaction_data.qr_code;

    bot.sendMessage(
      msg.chat.id,
      `💸 *Pagamento PIX*\n\n📦 Plano mensal (30 dias)\n💰 Valor: R$ 59,90\n\n🔑 *PIX Copia e Cola:*\n\`${qr}\`\n\n✅ Liberação automática.`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(msg.chat.id, "❌ Erro ao gerar PIX.");
  }
});

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  const id = req.body?.data?.id;
  if (!id) return res.sendStatus(200);

  const pagamento = await mercadopago.payment.get(id);

  if (pagamento.body.status === "approved") {
    const telegram_id = pagamento.body.metadata.telegram_id;
    const expira = Date.now() + 30 * 86400000;

    db.run(
      "UPDATE users SET plano='pago', expira_em=? WHERE telegram_id=?",
      [expira, telegram_id]
    );

    bot.sendMessage(
      telegram_id,
      "✅ *Pagamento confirmado!*\n\n🔓 Plano mensal ativo por 30 dias.",
      { parse_mode: "Markdown" }
    );
  }

  res.sendStatus(200);
});

// === EXPRESS ===
app.get("/", (_, res) => res.send("🚀 Bot rodando"));
app.listen(PORT, () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
);
