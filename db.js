const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.run('PRAGMA journal_mode = WAL;');
  }
});

// Initialize Tables immediately
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    roll_no TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    cash REAL DEFAULT 1000000.0,
    token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stocks (
    symbol TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    p0 REAL NOT NULL,
    current_price REAL NOT NULL,
    status TEXT DEFAULT 'OPEN'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS holdings (
    user_id INTEGER,
    symbol TEXT,
    qty INTEGER DEFAULT 0,
    avg_cost REAL DEFAULT 0.0,
    PRIMARY KEY(user_id, symbol)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    symbol TEXT,
    side TEXT,
    qty INTEGER,
    price REAL,
    fee REAL,
    idempotency_key TEXT UNIQUE,
    ts DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`, () => {
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('mode', 'REPLAY')`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('multiplier', '20')`);
    db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('trading_open', 'true')`);
  });
});

module.exports = db;