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

function podeUsarBot(user) {
  if (!user) return false;

  if (user.plano === "pago") {
    if (!user.expira_em) return true;
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

// ===== COMANDOS =====
bot.onText(/\/start/, (msg) => {
  criarUsuarioDemo(msg.from.id);

  bot.sendMessage(
    msg.chat.id,
    "🤖 *Auto Analista Bac Bo*\n\n🎯 Plano DEMO ativo\n📌 1 entrada por dia\n\n💳 Para plano pago use /pix",
    { parse_mode: "Markdown" }
  );
});

// 🧾 STATUS
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

// 💸 PIX — GERAR PAGAMENTO
bot.onText(/\/pix/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  try {
    const pagamento = await mercadopago.payment.create({
      transaction_amount: 29.9,
      description: "Plano PAGO - Auto Analista Bac Bo (30 dias)",
      payment_method_id: "pix",
      payer: {
        email: `user${telegramId}@bot.com`,
      },
      metadata: {
        telegram_id: telegramId,
      },
    });

    const qr =
      pagamento.body.point_of_interaction.transaction_data.qr_code;

    bot.sendMessage(
      chatId,
      `💸 *Pagamento PIX*\n\n📌 Valor: R$29,90\n⏳ Plano de 30 dias\n\n🔑 *PIX Copia e Cola:*\n\`${qr}\`\n\n✅ O acesso será liberado automaticamente após o pagamento.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error(err);
    bot.sendMessage(chatId, "❌ Erro ao gerar PIX. Tente novamente.");
  }
});

// ===== WEBHOOK MERCADO PAGO =====
app.post("/webhook", async (req, res) => {
  try {
    const paymentId = req.body?.data?.id;
    if (!paymentId) return res.sendStatus(200);

    const payment = await mercadopago.payment.get(paymentId);

    if (payment.body.status === "approved") {
      const telegramId = payment.body.metadata.telegram_id;
      const expira = Date.now() + 30 * 86400000;

      db.run(
        `
        UPDATE users 
        SET plano = 'pago', expira_em = ?
        WHERE telegram_id = ?
        `,
        [expira, telegramId]
      );

      bot.sendMessage(
        telegramId,
        "✅ *Pagamento confirmado!*\n\n🔓 Plano PAGO ativado por 30 dias.",
        { parse_mode: "Markdown" }
      );
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook erro:", err);
    res.sendStatus(500);
  }
});

// ===== BLOQUEIO TOTAL =====
bot.on("message", (msg) => {
  if (!msg.text) return;

  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  if (telegramId === ADMIN_ID) return;

  if (
    msg.text.startsWith("/start") ||
    msg.text.startsWith("/status") ||
    msg.text.startsWith("/pix")
  ) {
    return;
  }

  getUser(telegramId, (user) => {
    if (!user) {
      criarUsuarioDemo(telegramId);
      return bot.sendMessage(chatId, "Use /start para iniciar.");
    }

    if (!podeUsarBot(user)) {
      return bot.sendMessage(
        chatId,
        "⛔ *Acesso bloqueado*\n\n📌 Plano DEMO: 1 entrada/dia\n💳 Use /pix para liberar acesso",
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
