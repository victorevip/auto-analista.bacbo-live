import express from "express";
import TelegramBot from "node-telegram-bot-api";
import mercadopago from "mercadopago";
import { db } from "./database.js";

console.log("🚀 Iniciando aplicação...");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ===== TOKEN =====
const TOKEN =
  process.env.BOT_TOKEN ||
  process.env.TELEGRAM_TOKEN ||
  process.env.AUTO_BACBO_TOKEN;

if (!TOKEN) {
  console.error("❌ Token não definido");
  process.exit(1);
}

// ===== MERCADO PAGO =====
if (!process.env.MP_ACCESS_TOKEN) {
  console.error("❌ MP_ACCESS_TOKEN não definido");
  process.exit(1);
}

mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// ===== BOT =====
const bot = new TelegramBot(TOKEN, { polling: true });

// ===== ESTADO =====
const emAnalise = {};
const historico = {};
const aguardandoResultado = {};
const aguardandoTipoWin = {};

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

// ===== MENU =====
function enviarMenu(chatId) {
  bot.sendMessage(chatId, "📌 *Menu principal*", {
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "▶️ Nova Análise", callback_data: "MENU_ANALISAR" }],
        [{ text: "📊 Status", callback_data: "MENU_STATUS" }],
        [{ text: "💳 Planos", callback_data: "MENU_PIX" }],
      ],
    },
  });
}

// ===== START =====
bot.onText(/\/start/, (msg) => {
  criarUsuarioDemo(msg.from.id);
  emAnalise[msg.from.id] = false;
  historico[msg.from.id] = [];
  enviarMenu(msg.chat.id);
});

// ===== STATUS =====
bot.onText(/\/status/, (msg) => {
  getUser(msg.from.id, (user) => {
    if (!user) return bot.sendMessage(msg.chat.id, "Use /start primeiro.");

    let texto = `📊 *STATUS*\n\nPlano: ${user.plano.toUpperCase()}`;

    if (user.plano === "demo") {
      texto += `\nEntradas hoje: ${user.entradas_hoje}/1`;
    }

    if (user.plano === "pago") {
      texto += `\nExpira em: ${new Date(user.expira_em).toLocaleDateString()}`;
    }

    bot.sendMessage(msg.chat.id, texto, { parse_mode: "Markdown" });
  });
});

// ===== PIX =====
bot.onText(/\/pix (30|90|365)/, async (msg, match) => {
  const dias = Number(match[1]);
  const telegramId = msg.from.id;
  const chatId = msg.chat.id;

  const valores = {
    30: 29.9,
    90: 79.9,
    365: 249.9,
  };

  try {
    const pagamento = await mercadopago.payment.create({
      transaction_amount: valores[dias],
      description: `Plano Bac Bo ${dias} dias`,
      payment_method_id: "pix",
      payer: {
        email: `user${telegramId}@bot.com`,
      },
      metadata: { telegram_id: telegramId, dias },
    });

    const pix =
      pagamento.body.point_of_interaction.transaction_data.qr_code;

    bot.sendMessage(
      chatId,
      `💳 *Pagamento PIX*\n\n📦 Plano: ${dias} dias\n💰 Valor: R$${valores[dias]}\n\n🔑 *PIX Copia e Cola:*\n\`${pix}\`\n\n⏳ Liberação automática após o pagamento.`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ Erro ao gerar pagamento PIX.");
  }
});

// ===== WEBHOOK =====
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const payment = await mercadopago.payment.get(paymentId);

    if (payment.body.status === "approved") {
      const { telegram_id, dias } = payment.body.metadata;
      const expira = Date.now() + dias * 86400000;

      db.run(
        "UPDATE users SET plano='pago', expira_em=? WHERE telegram_id=?",
        [expira, telegram_id]
      );

      bot.sendMessage(
        telegram_id,
        `✅ *Pagamento confirmado!*\nPlano ativo por ${dias} dias.`,
        { parse_mode: "Markdown" }
      );
    }

    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// ===== CALLBACK MENU =====
bot.on("callback_query", (q) => {
  const chatId = q.message.chat.id;

  if (q.data === "MENU_ANALISAR") bot.sendMessage(chatId, "/analisar");
  if (q.data === "MENU_STATUS") bot.sendMessage(chatId, "/status");
  if (q.data === "MENU_PIX")
    bot.sendMessage(chatId, "/pix 30\n/pix 90\n/pix 365");
});

// ===== EXPRESS =====
app.get("/", (_, res) => res.send("🚀 Bot rodando"));

app.listen(PORT, () =>
  console.log(`✅ Servidor rodando na porta ${PORT}`)
);
