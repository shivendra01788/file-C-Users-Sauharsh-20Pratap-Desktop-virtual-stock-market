const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./db');

// FIXED IMPORTS: Removed './engine/' because your files are in the root directory
const { initializeStocks } = require('./marketData');
const { computeNextPrice, applyMultiplier } = require('./priceEngine');
const { getLivePrice, refreshTargets, resetBaselines, applyShock, getFeedStatus } = require('./liveApiFetcher');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

// FIXED FRONTEND ROUTING: Serving files directly from the root directory securely
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Explicitly serve your CSS and JS files assuming they were also uploaded flat
app.get('/css/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});

app.get('/js/client.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'client.js'));
});


initializeStocks();

// --- API ROUTES: ONE-CLICK GUEST JOIN WITH TRADER NAME ---
app.post('/api/join', (req, res) => {
  const { guest_id, custom_name } = req.body;
  if (!guest_id) return res.status(400).json({ error: 'System error: Missing identity token.' });

  db.get(`SELECT * FROM users WHERE roll_no = ?`, [guest_id], (err, user) => {
    if (err) return res.status(500).json({ error: 'Database error.' });
    
    if (user) {
      const finalName = (custom_name && custom_name.trim() !== '') ? custom_name.trim() : user.name;
      const token = crypto.randomBytes(24).toString('hex');
      
      db.run(`UPDATE users SET token = ?, name = ? WHERE id = ?`, [token, finalName, user.id], () => {
        res.json({ success: true, user: { id: user.id, name: finalName, roll_no: user.roll_no, cash: user.cash, token } });
      });
    } else {
      const fallbackNum = Math.floor(1000 + Math.random() * 9000);
      const finalName = (custom_name && custom_name.trim() !== '') ? custom_name.trim() : `Trader ${fallbackNum}`;
      const dummyPassword = 'guest_password';
      const token = crypto.randomBytes(24).toString('hex');
      
      db.run(
        `INSERT INTO users (name, roll_no, password, cash, token) VALUES (?, ?, ?, 1000000.0, ?)`,
        [finalName, guest_id, dummyPassword, token],
        function (err) {
          if (err) return res.status(400).json({ error: 'Failed to initialize terminal.' });
          res.json({ success: true, user: { id: this.lastID, name: finalName, roll_no: guest_id, cash: 1000000.0, token } });
        }
      );
    }
  });
});

// --- API ROUTES: TRADING / ORDERS ---
app.post('/api/trade', (req, res) => {
  const { user_id, token, symbol, side, qty, idempotency_key } = req.body;
  
  if (!user_id || !token || !symbol || !side || !qty || qty <= 0 || !idempotency_key) {
    return res.status(400).json({ error: 'Invalid order parameters.' });
  }

  db.get(`SELECT value FROM settings WHERE key = 'trading_open'`, (err, sRow) => {
    if (!sRow || sRow.value !== 'true') return res.status(403).json({ error: 'Trading is currently closed by Admin.' });

    db.get(`SELECT * FROM stocks WHERE symbol = ?`, [symbol], (err, stock) => {
      if (err || !stock) return res.status(400).json({ error: 'Stock symbol not found in database.' });
      if (stock.status !== 'OPEN') return res.status(400).json({ error: `Stock ${symbol} is currently Halted by Admin.` });

      const price = stock.current_price;
      const subtotal = price * qty;
      const fee = subtotal * 0.001; 

      db.serialize(() => {
        db.run('BEGIN TRANSACTION;');
        db.get(`SELECT cash, token FROM users WHERE id = ?`, [user_id], (err, user) => {
          if (err || !user || user.token !== token) { db.run('ROLLBACK;'); return res.status(401).json({ error: 'Unauthorized session.' }); }

          if (side === 'BUY') {
            const totalCost = subtotal + fee;
            if (user.cash < totalCost) { db.run('ROLLBACK;'); return res.status(400).json({ error: 'Insufficient cash balance.' }); }

            db.all(`SELECT h.symbol, h.qty, s.current_price FROM holdings h JOIN stocks s ON h.symbol = s.symbol WHERE h.user_id = ?`, [user_id], (err, holdings) => {
              let portfolioVal = user.cash;
              let stockVal = subtotal;
              holdings.forEach(h => {
                portfolioVal += h.qty * h.current_price;
                if (h.symbol === symbol) stockVal += h.qty * h.current_price;
              });
              if ((stockVal / portfolioVal) > 0.30) { db.run('ROLLBACK;'); return res.status(400).json({ error: 'Violates 30% single-stock concentration limit.' }); }

              db.run(`UPDATE users SET cash = cash - ? WHERE id = ?`, [totalCost, user_id]);
              db.run(`INSERT INTO holdings (user_id, symbol, qty, avg_cost) VALUES (?, ?, ?, ?) 
                      ON CONFLICT(user_id, symbol) DO UPDATE SET avg_cost = ((avg_cost * qty) + ?) / (qty + ?), qty = qty + ?`,
                      [user_id, symbol, qty, price, subtotal, qty, qty]);
              recordOrderAndCommit(user_id, symbol, side, qty, price, fee, idempotency_key, res);
            });
          } else if (side === 'SELL') {
            db.get(`SELECT qty FROM holdings WHERE user_id = ? AND symbol = ?`, [user_id, symbol], (err, holding) => {
              if (!holding || holding.qty < qty) { db.run('ROLLBACK;'); return res.status(400).json({ error: 'Insufficient shares to sell.' }); }
              const netProceeds = subtotal - fee;
              db.run(`UPDATE users SET cash = cash + ? WHERE id = ?`, [netProceeds, user_id]);
              db.run(`UPDATE holdings SET qty = qty - ? WHERE user_id = ? AND symbol = ?`, [qty, user_id, symbol]);
              recordOrderAndCommit(user_id, symbol, side, qty, price, fee, idempotency_key, res);
            });
          }
        });
      });
    });
  });
});

function recordOrderAndCommit(user_id, symbol, side, qty, price, fee, idempotency_key, res) {
  db.run(`INSERT INTO orders (user_id, symbol, side, qty, price, fee, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [user_id, symbol, side, qty, price, fee, idempotency_key], (err) => {
      if (err) { db.run('ROLLBACK;'); return res.status(400).json({ error: 'Duplicate order detected.' }); }
      db.run('COMMIT;', () => res.json({ success: true, executed_price: price, fee }));
    });
}

// --- PORTFOLIO API ---
app.get('/api/portfolio/:userId', (req, res) => {
  const userId = req.params.userId;
  db.get(`SELECT id, name, roll_no, cash FROM users WHERE id = ?`, [userId], (err, user) => {
    if (err || !user) return res.status(404).json({ error: 'User not found' });
    db.all(`SELECT h.symbol, h.qty, h.avg_cost, s.current_price FROM holdings h JOIN stocks s ON h.symbol = s.symbol WHERE h.user_id = ? AND h.qty > 0`, [userId], (err, holdings) => {
      res.json({ user, holdings: holdings || [] });
    });
  });
});

// --- API ROUTES: ADMIN ---
app.get('/api/admin/state', (req, res) => {
  db.get(`SELECT value FROM settings WHERE key = 'trading_open'`, (err, sRow) => {
    db.all(`SELECT symbol, name, status FROM stocks`, (err, stocks) => {
      res.json({ trading_open: sRow ? sRow.value : 'false', stocks });
    });
  });
});

app.post('/api/admin/trading', (req, res) => {
  const val = req.body.action === 'open' ? 'true' : 'false';
  if (val === 'true') resetBaselines();
  db.run(`UPDATE settings SET value = ? WHERE key = 'trading_open'`, [val], () => res.json({ success: true, trading_open: val }));
});

app.post('/api/admin/halt', (req, res) => {
  db.run(`UPDATE stocks SET status = ? WHERE symbol = ?`, [req.body.status, req.body.symbol], () => res.json({ success: true }));
});

app.post('/api/admin/news', (req, res) => {
  const { symbol, headline, shock } = req.body;
  const shockPct = parseFloat(shock);
  if (!symbol || isNaN(shockPct)) return res.status(400).json({ error: 'Invalid news parameters.' });

  db.get(`SELECT current_price FROM stocks WHERE symbol = ?`, [symbol], (err, stock) => {
    if (err || !stock) return res.status(404).json({ error: 'Stock not found.' });
    applyShock(symbol, shockPct); 
    const newPrice = Math.max(5.0, stock.current_price * (1 + shockPct / 100.0));
    db.run(`UPDATE stocks SET current_price = ? WHERE symbol = ?`, [newPrice, symbol], () => {
      io.emit('news_alert', { symbol, headline, shock });
      res.json({ success: true });
    });
  });
});

app.all('/api/admin/sync-prices', (req, res) => {
  const live = getFeedStatus().live_prices;
  const symbols = Object.keys(live);
  if (symbols.length === 0) return res.status(503).json({ error: 'No live prices received yet. Check /api/admin/feed-status.' });
  let done = 0;
  symbols.forEach(sym => {
    db.run(`UPDATE stocks SET p0 = ?, current_price = ? WHERE symbol = ?`, [live[sym], live[sym], sym], () => {
      if (++done === symbols.length) {
        resetBaselines(true);
        res.json({ success: true, updated: symbols.length });
      }
    });
  });
});

app.get('/api/admin/feed-status', (req, res) => res.json(getFeedStatus()));

// --- BACKGROUND LOOPS ---
function pollLiveTargets() {
  db.all(`SELECT symbol FROM stocks`, (err, stocks) => {
    if (err || !stocks || stocks.length === 0) return;
    refreshTargets(stocks.map(s => s.symbol));
  });
}
pollLiveTargets(); 
setInterval(pollLiveTargets, Number(process.env.POLL_MS) || 30000);

// --- HIGH-SPEED 20x WEBSOCKET TICKER ---
setInterval(() => {
  db.get(`SELECT value FROM settings WHERE key = 'trading_open'`, (err, row) => {
    if (row && row.value === 'true') {
      db.all(`SELECT * FROM stocks WHERE status = 'OPEN'`, (err, stocks) => {
        if (!stocks) return;

        stocks.forEach(stock => {
          const newPrice = getLivePrice(stock.symbol, stock.current_price, stock.p0);
          db.run(`UPDATE stocks SET current_price = ? WHERE symbol = ?`, [newPrice, stock.symbol]);
        });

        db.all(`SELECT symbol, current_price, status FROM stocks`, (err, updatedStocks) => {
          if (!err) io.emit('price_update', updatedStocks);
        });
      });
    }
  });
}, 2000); 

setInterval(() => {
  const query = `
    SELECT u.id, u.name, u.roll_no, u.cash, COALESCE(SUM(h.qty * s.current_price), 0) as portfolio_value
    FROM users u LEFT JOIN holdings h ON u.id = h.user_id LEFT JOIN stocks s ON h.symbol = s.symbol
    GROUP BY u.id ORDER BY (u.cash + portfolio_value) DESC LIMIT 20
  `;
  db.all(query, (err, rows) => { if (!err) io.emit('leaderboard_update', rows); });
}, 15000);

io.on('connection', (socket) => { console.log('Player connected:', socket.id); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => { console.log(`Virtual Stock Market Server running on port ${PORT}`); });
