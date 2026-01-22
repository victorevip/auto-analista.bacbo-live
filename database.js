import sqlite3 from "sqlite3";

// Ativa modo verbose (melhor debug)
sqlite3.verbose();

console.log("🗄️ Conectando ao SQLite...");

// Caminho do banco (Railway aceita arquivo local)
export const db = new sqlite3.Database("./db.sqlite", (err) => {
  if (err) {
    console.error("❌ Erro ao conectar no SQLite:", err.message);
  } else {
    console.log("✅ Banco SQLite conectado com sucesso");
  }
});

// Criação das tabelas
db.serialize(() => {
  db.run(
    `
    CREATE TABLE IF NOT EXISTS users (
      telegram_id TEXT PRIMARY KEY,
      plano TEXT DEFAULT 'demo',
      expira_em INTEGER,
      saldo_demo REAL DEFAULT 1000,
      entradas_hoje INTEGER DEFAULT 0,
      ultimo_dia INTEGER DEFAULT 0,
      criado_em INTEGER
    )
    `,
    (err) => {
      if (err) {
        console.error("❌ Erro ao criar tabela users:", err.message);
      } else {
        console.log("✅ Tabela users pronta");
      }
    }
  );
});
