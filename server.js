const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const yahooFinance = require('yahoo-finance2').default;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. IN-MEMORY DATABASE
// ==========================================
const users = {};      // user_id -> { id, name, cash, token }
const portfolios = {}; // user_id -> [ { symbol, qty, avg_cost } ]
const STARTING_CASH = 1000000; // ₹10,00,000 margin

// ==========================================
// 2. 50 STOCK UNIVERSE & YAHOO FINANCE MAP
// ==========================================
let stocks = [
  // IT & Tech
  { symbol: 'RELIANCE', yahooTicker: 'RELIANCE.NS', current_price: 2540.50, volatility: 0.002 },
  { symbol: 'TCS', yahooTicker: 'TCS.NS', current_price: 3450.25, volatility: 0.0018 },
  { symbol: 'INFY', yahooTicker: 'INFY.NS', current_price: 1420.75, volatility: 0.0025 },
  { symbol: 'HCLTECH', yahooTicker: 'HCLTECH.NS', current_price: 1250.10, volatility: 0.0022 },
  { symbol: 'WIPRO', yahooTicker: 'WIPRO.NS', current_price: 410.30, volatility: 0.0028 },
  { symbol: 'TECHM', yahooTicker: 'TECHM.NS', current_price: 1180.50, volatility: 0.0024 },
  { symbol: 'LTIM', yahooTicker: 'LTIM.NS', current_price: 5200.00, volatility: 0.003 },
  { symbol: 'PERSISTENT', yahooTicker: 'PERSISTENT.NS', current_price: 4800.00, volatility: 0.0032 },
  { symbol: 'COFORGE', yahooTicker: 'COFORGE.NS', current_price: 4600.00, volatility: 0.0031 },
  { symbol: 'MPHASIS', yahooTicker: 'MPHASIS.NS', current_price: 2350.00, volatility: 0.0027 },

  // Banking & Financial Services
  { symbol: 'HDFCBANK', yahooTicker: 'HDFCBANK.NS', current_price: 1620.00, volatility: 0.0015 },
  { symbol: 'ICICIBANK', yahooTicker: 'ICICIBANK.NS', current_price: 980.10, volatility: 0.0022 },
  { symbol: 'SBIN', yahooTicker: 'SBIN.NS', current_price: 590.30, volatility: 0.003 },
  { symbol: 'KOTAKBANK', yahooTicker: 'KOTAKBANK.NS', current_price: 1750.00, volatility: 0.0019 },
  { symbol: 'AXISBANK', yahooTicker: 'AXISBANK.NS', current_price: 980.50, volatility: 0.0024 },
  { symbol: 'BAJFINANCE', yahooTicker: 'BAJFINANCE.NS', current_price: 7200.00, volatility: 0.0035 },
  { symbol: 'BAJAJFINSV', yahooTicker: 'BAJAJFINSV.NS', current_price: 1580.00, volatility: 0.003 },
  { symbol: 'INDUSINDBK', yahooTicker: 'INDUSINDBK.NS', current_price: 1420.00, volatility: 0.0033 },
  { symbol: 'SBICARD', yahooTicker: 'SBICARD.NS', current_price: 750.00, volatility: 0.0028 },
  { symbol: 'CHOLAFIN', yahooTicker: 'CHOLAFIN.NS', current_price: 1150.00, volatility: 0.0029 },

  // FMCG & Consumer Goods
  { symbol: 'ITC', yahooTicker: 'ITC.NS', current_price: 450.60, volatility: 0.001 },
  { symbol: 'HUL', yahooTicker: 'HINDUNILVR.NS', current_price: 2560.80, volatility: 0.0012 },
  { symbol: 'NESTLEIND', yahooTicker: 'NESTLEIND.NS', current_price: 2450.00, volatility: 0.0015 },
  { symbol: 'BRITANNIA', yahooTicker: 'BRITANNIA.NS', current_price: 4800.00, volatility: 0.0016 },
  { symbol: 'TITAN', yahooTicker: 'TITAN.NS', current_price: 3100.20, volatility: 0.0025 },
  { symbol: 'ASIANPAINT', yahooTicker: 'ASIANPAINT.NS', current_price: 2950.40, volatility: 0.0021 },
  { symbol: 'TRENT', yahooTicker: 'TRENT.NS', current_price: 3800.00, volatility: 0.0035 },
  { symbol: 'TATACONSUM', yahooTicker: 'TATACONSUM.NS', current_price: 1100.00, volatility: 0.0022 },
  { symbol: 'DABUR', yahooTicker: 'DABUR.NS', current_price: 550.00, volatility: 0.0017 },
  { symbol: 'MARICO', yahooTicker: 'MARICO.NS', current_price: 580.00, volatility: 0.0018 },

  // Automobiles & Ancillaries
  { symbol: 'TATAMOTORS', yahooTicker: 'TATAMOTORS.NS', current_price: 640.75, volatility: 0.0032 },
  { symbol: 'M&M', yahooTicker: 'M&M.NS', current_price: 1560.30, volatility: 0.0026 },
  { symbol: 'MARUTI', yahooTicker: 'MARUTI.NS', current_price: 10450.00, volatility: 0.0018 },
  { symbol: 'BAJAJ-AUTO', yahooTicker: 'BAJAJ-AUTO.NS', current_price: 4890.00, volatility: 0.002 },
  { symbol: 'EICHERMOT', yahooTicker: 'EICHERMOT.NS', current_price: 3900.00, volatility: 0.0023 },
  { symbol: 'HEROMOTOCO', yahooTicker: 'HEROMOTOCO.NS', current_price: 4500.00, volatility: 0.0021 },
  { symbol: 'TVSMOTOR', yahooTicker: 'TVSMOTOR.NS', current_price: 2100.00, volatility: 0.0027 },

  // Energy, Oil, Gas & Utilities
  { symbol: 'ONGC', yahooTicker: 'ONGC.NS', current_price: 185.20, volatility: 0.0025 },
  { symbol: 'NTPC', yahooTicker: 'NTPC.NS', current_price: 240.60, volatility: 0.0022 },
  { symbol: 'POWERGRID', yahooTicker: 'POWERGRID.NS', current_price: 210.30, volatility: 0.0019 },
  { symbol: 'BPCL', yahooTicker: 'BPCL.NS', current_price: 450.00, volatility: 0.0028 },
  { symbol: 'COALINDIA', yahooTicker: 'COALINDIA.NS', current_price: 310.80, volatility: 0.0028 },

  // Metals, Infrastructure & Conglomerates
  { symbol: 'L&T', yahooTicker: 'LT.NS', current_price: 2890.40, volatility: 0.002 },
  { symbol: 'BHARTIARTL', yahooTicker: 'BHARTIARTL.NS', current_price: 890.00, volatility: 0.002 },
  { symbol: 'TATASTEEL', yahooTicker: 'TATASTEEL.NS', current_price: 125.40, volatility: 0.0035 },
  { symbol: 'HINDALCO', yahooTicker: 'HINDALCO.NS', current_price: 520.00, volatility: 0.0031 },
  { symbol: 'JSWSTEEL', yahooTicker: 'JSWSTEEL.NS', current_price: 850.00, volatility: 0.0029 },
  { symbol: 'ADANIENT', yahooTicker: 'ADANIENT.NS', current_price: 2450.00, volatility: 0.0045 },
  { symbol: 'ADANIPORTS', yahooTicker: 'ADANIPORTS.NS', current_price: 820.50, volatility: 0.0038 },
  { symbol: 'SUNPHARMA', yahooTicker: 'SUNPHARMA.NS', current_price: 1150.00, volatility: 0.0017 }
];

// Fetch real opening base prices from Yahoo Finance on startup
async function initializeMarketPrices() {
  console.log('🔄 Fetching real market base prices for 50 tickers from Yahoo Finance...');
  for (let stock of stocks) {
    try {
      const quote = await yahooFinance.quote(stock.yahooTicker);
      if (quote && quote.regularMarketPrice) {
        stock.current_price = Number(quote.regularMarketPrice.toFixed(2));
      }
    } catch (err) {
      // Silently fall back to default price if rate-limited or offline
    }
  }
  console.log('🚀 Market price initialization complete across 50 instruments.');
}

// ==========================================
// 3. 20X SPEED SIMULATION ENGINE
// ==========================================
setInterval(() => {
  stocks.forEach(stock => {
    const direction = Math.random() > 0.5 ? 1 : -1;
    const changePercent = Math.random() * stock.volatility;
    const changeAmount = stock.current_price * changePercent * direction;
    const momentum = (Math.random() - 0.5) * 0.001; 
    
    stock.current_price = Number((stock.current_price + changeAmount + (stock.current_price * momentum)).toFixed(2));
  });

  io.emit('price_update', stocks);
}, 800);

// ==========================================
// 4. LEADERBOARD ENGINE
// ==========================================
setInterval(() => {
  const leaderboard = Object.values(users).map(user => {
    let portfolioValue = 0;
    const userHoldings = portfolios[user.id] || [];
    
    userHoldings.forEach(h => {
      const stock = stocks.find(s => s.symbol === h.symbol);
      if (stock) portfolioValue += h.qty * stock.current_price;
    });

    return { id: user.id, name: user.name, cash: user.cash, portfolio_value: portfolioValue };
  });

  leaderboard.sort((a, b) => (b.cash + b.portfolio_value) - (a.cash + a.portfolio_value));
  io.emit('leaderboard_update', leaderboard);
}, 2000);

// ==========================================
// 5. REST API ROUTES (Client Terminal)
// ==========================================
app.post('/api/join', (req, res) => {
  const { guest_id, custom_name } = req.body;
  if (!users[guest_id]) {
    users[guest_id] = { id: guest_id, name: custom_name || `Trader_${Math.floor(Math.random()*9000)+1000}`, cash: STARTING_CASH, token: 'tok_'+Date.now() };
    portfolios[guest_id] = [];
  } else if (custom_name) users[guest_id].name = custom_name;
  res.json({ success: true, user: users[guest_id] });
});

app.get('/api/portfolio/:user_id', (req, res) => {
  const user = users[req.params.user_id];
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user, holdings: portfolios[user.id] || [] });
});

app.post('/api/trade', (req, res) => {
  const { user_id, symbol, side, qty } = req.body;
  const user = users[user_id];
  const stock = stocks.find(s => s.symbol === symbol);

  if (!user || !stock || qty <= 0) return res.status(400).json({ success: false, error: 'Invalid order' });

  const executePrice = stock.current_price;
  const totalCost = executePrice * qty;
  let holdings = portfolios[user.id];

  if (side === 'BUY') {
    if (user.cash < totalCost) return res.status(400).json({ success: false, error: 'Insufficient margin' });
    user.cash -= totalCost;
    const existing = holdings.find(h => h.symbol === symbol);
    if (existing) {
        existing.avg_cost = ((existing.qty * existing.avg_cost) + totalCost) / (existing.qty + qty);
        existing.qty += qty;
    } else holdings.push({ symbol, qty, avg_cost: executePrice });
  } else if (side === 'SELL') {
    const existing = holdings.find(h => h.symbol === symbol);
    if (!existing || existing.qty < qty) return res.status(400).json({ success: false, error: 'Insufficient shares' });
    user.cash += totalCost;
    existing.qty -= qty;
    if (existing.qty === 0) portfolios[user.id] = holdings.filter(h => h.symbol !== symbol);
  }
  res.json({ success: true, executed_price: executePrice });
});

// ==========================================
// 6. ADMIN CONTROL PANEL ROUTES
// ==========================================
app.get('/api/admin/state', (req, res) => {
  const adminUsers = Object.values(users).map(u => {
    let portfolioValue = 0;
    const userHoldings = portfolios[u.id] || [];
    userHoldings.forEach(h => {
      const stock = stocks.find(s => s.symbol === h.symbol);
      if (stock) portfolioValue += h.qty * stock.current_price;
    });
    return { ...u, portfolioValue, holdings: userHoldings };
  });
  res.json({ users: adminUsers, stocks });
});

app.post('/api/admin/news', (req, res) => {
  const { symbol, headline, shock_percent } = req.body;
  const shockValue = parseFloat(shock_percent) || 0;

  if (symbol && symbol !== 'GLOBAL') {
    const stock = stocks.find(s => s.symbol === symbol);
    if (stock) stock.current_price = Number((stock.current_price * (1 + shockValue)).toFixed(2));
  } else if (symbol === 'GLOBAL') {
    stocks.forEach(stock => stock.current_price = Number((stock.current_price * (1 + shockValue)).toFixed(2)));
  }

  io.emit('news_alert', { symbol, headline, shock: shockValue });
  res.json({ success: true, message: 'Shock deployed.' });
});

// ==========================================
// START SERVER & FETCH LIVE INITIAL PRICES
// ==========================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`🚀 TradePro Engine running on http://localhost:${PORT}`);
  console.log(`⚙️  Admin Panel running on http://localhost:${PORT}/admin.html`);
  await initializeMarketPrices();
});