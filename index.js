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

// ===== ESTRATÉGIA POUP =====
const historico = {}; // por usuário

function emojiParaLetra(t) {
  if (t === "🔵") return "P";
  if (t === "🔴") return "B";
  if (t === "🟠") return "E";
  return null;
}

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

// ===== COMANDOS =====
bot.onText(/\/start/, (msg) => {
  criarUsuarioDemo(msg.from.id);

  bot.sendMessage(
    msg.chat.id,
    "🤖 *Auto Analista Bac Bo*\n\n🎯 Plano DEMO ativo\n📌 1 entrada por dia\n\n📥 *CATALOGAÇÃO MANUAL*\nEnvie:\n🔵 Azul\n🔴 Vermelho\n🟠 Empate\n\n💳 Planos:\n/pix 30\n/pix 90\n/pix 365",
    { parse_mode: "Markdown" }
  );
});

bot.onText(/\/status/, (msg) => {
  getUser(msg.from.id, (user) => {
    if (!user) return bot.sendMessage(msg.chat.id, "Use /start primeiro.");

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

// ===== PIX COM PLANOS =====
bot.onText(/\/pix (30|90|365)/, async (msg, match) => {
  const telegramId = msg.from.id;
  const chatId = msg.chat.id;
  const dias = parseInt(match[1]);

  const precos = {
    30: 29.9,
    90: 79.9,
    365: 249.9,
  };

  try {
    const pagamento = await mercadopago.payment.create({
      transaction_amount: precos[dias],
      description: `Plano Auto Analista Bac Bo - ${dias} dias`,
      payment_method_id: "pix",
      payer: {
        email: `user${telegramId}@bot.com`,
      },
      metadata: {
        telegram_id: telegramId,
        dias,
      },
    });

    const qr =
      pagamento.body.point_of_interaction.transaction_data.qr_code;

    bot.sendMessage(
      chatId,
      `💸 *Pagamento PIX*\n\n📦 Plano: ${dias} dias\n💰 Valor: R$${precos[dias]}\n\n🔑 *PIX Copia e Cola:*\n\`${qr}\`\n\n✅ Liberação automática após pagamento.`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ Erro ao gerar PIX.");
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
      const dias = payment.body.metadata.dias || 30;

      getUser(telegramId, (user) => {
        if (user && user.plano === "pago" && user.expira_em > Date.now()) {
          return;
        }

        const expira = Date.now() + dias * 86400000;

        db.run(
          `UPDATE users SET plano='pago', expira_em=? WHERE telegram_id=?`,
          [expira, telegramId]
        );

        bot.sendMessage(
          telegramId,
          `✅ *Pagamento confirmado!*\n\n🔓 Plano ativado por ${dias} dias.`,
          { parse_mode: "Markdown" }
        );
      });
    }

    res.sendStatus(200);
  } catch (err) {
    console.error("Webhook erro:", err);
    res.sendStatus(500);
  }
});

// ===== CATALOGAÇÃO =====
bot.on("message", (msg) => {
  if (!msg.text) return;

  const telegramId = msg.from.id;
  const chatId = msg.chat.id;

  if (
    msg.text.startsWith("/start") ||
    msg.text.startsWith("/status") ||
    msg.text.startsWith("/pix")
  ) return;

  const letra = emojiParaLetra(msg.text.trim());
  if (!letra) return;

  getUser(telegramId, (user) => {
    if (!user) return;

    if (!podeUsarBot(user)) {
      return bot.sendMessage(
        chatId,
        "⛔ *Acesso bloqueado*\n\n💳 Planos:\n/pix 30\n/pix 90\n/pix 365",
        { parse_mode: "Markdown" }
      );
    }

    if (!historico[telegramId]) historico[telegramId] = [];
    historico[telegramId].push(letra);
    if (historico[telegramId].length > 20)
      historico[telegramId].shift();

    registrarEntrada(user);

    const sinal = analisarPOUP(historico[telegramId]);

    bot.sendMessage(
      chatId,
      `📥 Histórico:\n${historico[telegramId].join(" ")}\n\n🎯 *SINAL*\n${sinal}`,
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
