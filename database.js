import sqlite3 from "sqlite3";

console.log("🗄️ Conectando ao SQLite...");

export const db = new sqlite3.Database("./db.sqlite", (err) => {
  if (err) {
    console.error("❌ Erro ao conectar no banco", err);
  } else {
    console.log("✅ Banco SQLite conectado");
  }
});

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      plano TEXT,
      expira_em INTEGER,
      saldo_demo REAL DEFAULT 1000,
      entradas_hoje INTEGER DEFAULT 0,
      ultimo_dia INTEGER DEFAULT 0,
      criado_em INTEGER
    )
  `, () => {
    console.log("✅ Tabela users pronta");
  });
});
