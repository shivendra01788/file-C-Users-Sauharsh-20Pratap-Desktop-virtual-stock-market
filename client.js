const socket = io();
let currentUser = JSON.parse(localStorage.getItem('vs_user')) || null;
let currentPrices = {};
let previousPrices = {};
let lastDirection = {};
let activeHoldings = [];

let tvChart = null, areaSeries = null;
let stockHistories = {};
let activeStockSymbol = 'RELIANCE';
let lastTimeTick = Math.floor(Date.now() / 1000);
let watchlistBuilt = false;

document.addEventListener('DOMContentLoaded', () => {
  if (currentUser) {
    showApp();
    fetchUserPortfolio();
  }
  initProChart();
});

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));
  document.querySelectorAll('.tab-view').forEach(view => view.style.display = 'none');

  const activeBtn = document.getElementById(`tab-btn-${tabId}`);
  const activeView = document.getElementById(`tab-${tabId}`);
  if (activeBtn) activeBtn.classList.add('active');
  if (activeView) {
    activeView.classList.add('active');
    activeView.style.display = 'block';
  }

  // Force chart engine to recalculate its canvas size when you click Trading Workspace
  if (tabId === 'terminal' && tvChart) {
    setTimeout(resizeChart, 100);
  }
}

// Works with lightweight-charts v3/v4 (addAreaSeries) AND v5 (addSeries(AreaSeries))
function createAreaSeries(chart, opts) {
  if (typeof chart.addAreaSeries === 'function') return chart.addAreaSeries(opts);
  if (typeof chart.addSeries === 'function' && LightweightCharts.AreaSeries) {
    return chart.addSeries(LightweightCharts.AreaSeries, opts);
  }
  throw new Error('Unsupported lightweight-charts version');
}

function initProChart() {
  const container = document.getElementById('chart-viewport');
  if (!container) return;

  try {
    const chartOptions = {
      autoSize: true,
      layout: {
        textColor: '#79859b',
        background: { type: 'solid', color: '#0c0e12' },
        attributionLogo: false
      },
      grid: { vertLines: { color: 'rgba(35, 41, 54, 0.6)' }, horzLines: { color: 'rgba(35, 41, 54, 0.6)' } },
      timeScale: { timeVisible: true, secondsVisible: true, borderColor: '#232936' },
      rightPriceScale: { borderColor: '#232936', autoScale: true },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      watermark: { visible: false }
    };

    tvChart = LightweightCharts.createChart(document.getElementById('tvchart'), chartOptions);

    areaSeries = createAreaSeries(tvChart, {
      topColor: 'rgba(0, 192, 135, 0.35)',
      bottomColor: 'rgba(0, 192, 135, 0.01)',
      lineColor: '#00c087',
      lineWidth: 2
    });

    window.addEventListener('resize', resizeChart);
  } catch (err) {
    console.error('Chart failed to start:', err);
    tvChart = null;
    areaSeries = null;
  }
}

function resizeChart() {
  const container = document.getElementById('chart-viewport');
  if (container && tvChart && container.clientWidth > 0) {
    tvChart.resize(container.clientWidth, container.clientHeight);
    tvChart.timeScale().fitContent();
  }
}

// Builds fake history that ENDS at the current price, to prevent jumps when live ticks start
function seedHistoricalData(symbol, currentPrice, anchorTime) {
  if (stockHistories[symbol] && stockHistories[symbol].length > 10) return;
  const base = (currentPrice && currentPrice > 0) ? currentPrice : 1000;
  const anchor = anchorTime || lastTimeTick;
  const N = 40;
  const points = new Array(N);
  let price = base;

  for (let i = N - 1; i >= 0; i--) {
    points[i] = { time: anchor - 2 * (N - i), value: Number(price.toFixed(2)) };
    price = price / (1 + (Math.random() - 0.5) * 0.006);
  }
  stockHistories[symbol] = points;
}

function selectStock(symbol) {
  activeStockSymbol = symbol;
  document.querySelectorAll('.wl-row').forEach(el => el.classList.remove('active'));
  const activeRow = document.getElementById(`wl-${symbol}`);
  if (activeRow) activeRow.classList.add('active');

  const price = currentPrices[symbol] || 0;
  document.getElementById('active-symbol-title').textContent = symbol;
  document.getElementById('order-dock-symbol').textContent = symbol;
  document.getElementById('active-symbol-price').textContent = `₹${price.toFixed(2)}`;
  document.getElementById('dock-ltp').textContent = `₹${price.toFixed(2)}`;

  calculateTotal();

  if (!stockHistories[symbol] || stockHistories[symbol].length < 10) seedHistoricalData(symbol, price, lastTimeTick);
  if (areaSeries && tvChart) {
    areaSeries.setData(stockHistories[symbol]);
    tvChart.timeScale().fitContent();
  }
}

function calculateTotal() {
  const qty = parseInt(document.getElementById('trade-qty').value) || 0;
  const price = currentPrices[activeStockSymbol] || 0;
  document.getElementById('trade-total').textContent = `₹${(qty * price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function executeTrade(side) {
  if (!activeStockSymbol) return;
  const qty = parseInt(document.getElementById('trade-qty').value);
  if (isNaN(qty) || qty <= 0) return alert('Enter a valid share quantity.');

  processOrder(activeStockSymbol, side, qty);
}

// SELL SPECIFIC QUANTITY FROM DASHBOARD
async function sellSpecific(symbol, maxQty) {
  const input = document.getElementById(`dash-sell-qty-${symbol}`);
  const qty = parseInt(input ? input.value : 0);

  if (isNaN(qty) || qty <= 0) {
    return alert('Please enter a valid share quantity to sell.');
  }

  if (qty > maxQty) {
    return alert(`You only own ${maxQty} shares of ${symbol}.`);
  }

  processOrder(symbol, 'SELL', qty);
}

async function processOrder(symbol, side, qty) {
  try {
    const res = await fetch('/api/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser.id, token: currentUser.token, symbol: symbol, side: side, qty: qty,
        idempotency_key: 'ord_' + Date.now() + '_' + Math.random().toString(36).substring(2)
      })
    });

    const data = await res.json();
    if (data.success) {
      fetchUserPortfolio();
      showToast(symbol, `Order Executed: ${side} ${qty} shares @ ₹${data.executed_price.toFixed(2)}`, side === 'BUY');
    } else {
      alert(`Order Rejected: ${data.error}`);
    }
  } catch (err) {
    alert('Communication error with matching engine.');
  }
}

async function joinMarket() {
  let guestId = localStorage.getItem('device_token');
  if (!guestId) { guestId = 'GST_' + Date.now() + '_' + Math.floor(Math.random() * 10000); localStorage.setItem('device_token', guestId); }
  const customName = document.getElementById('trader-name-input') ? document.getElementById('trader-name-input').value.trim() : '';

  const res = await fetch('/api/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guest_id: guestId, custom_name: customName }) });
  const data = await res.json();
  if (data.success) {
    currentUser = data.user; localStorage.setItem('vs_user', JSON.stringify(currentUser));
    showApp(); fetchUserPortfolio();
  } else document.getElementById('auth-msg').textContent = data.error;
}

function showApp() {
  document.getElementById('landing-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'block';
  document.getElementById('header-trader-tag').textContent = `TRADER: ${currentUser.name.toUpperCase()}`;
  updateCashDisplay();
  setTimeout(resizeChart, 150);
}

function updateCashDisplay() {
  const cashStr = `₹${Number(currentUser.cash).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (document.getElementById('header-cash-val')) document.getElementById('header-cash-val').textContent = cashStr;
  if (document.getElementById('dash-cash')) document.getElementById('dash-cash').textContent = cashStr;
}

function logout() { localStorage.removeItem('vs_user'); location.reload(); }

function flash(el, dir) {
  if (!el) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth;
  el.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
}

function setDirectionClass(el, dir) {
  if (!el) return;
  el.classList.toggle('text-up', dir === 'up');
  el.classList.toggle('text-down', dir === 'down');
}

function ensureWatchlist(stocks, tickTime) {
  const wlList = document.getElementById('market-list');
  if (!wlList) return;

  const sorted = stocks.slice().sort((a, b) => a.symbol.localeCompare(b.symbol));
  sorted.forEach(stock => {
    if (document.getElementById(`wl-${stock.symbol}`)) return;
    const price = Number(stock.current_price) || 0;

    const li = document.createElement('li');
    li.className = 'wl-row';
    li.id = `wl-${stock.symbol}`;
    li.onclick = () => selectStock(stock.symbol);
    li.innerHTML = `
      <div><div class="wl-sym">${stock.symbol}</div><div class="wl-sub" id="wl-sub-${stock.symbol}">NSE EQUITIES</div></div>
      <div><div class="wl-price text-up" id="wl-price-${stock.symbol}">₹${price.toFixed(2)}</div></div>
    `;
    wlList.appendChild(li);
    currentPrices[stock.symbol] = price;
    seedHistoricalData(stock.symbol, price, tickTime);
  });

  if (!watchlistBuilt && sorted.length > 0) {
    watchlistBuilt = true;
    const defaultSym = sorted.find(s => s.symbol === 'RELIANCE') ? 'RELIANCE' : sorted[0].symbol;
    try { selectStock(defaultSym); } catch (e) { console.error('selectStock failed:', e); }
  }
}

function applyTick(stock, tickTime) {
  const sym = stock.symbol;
  const price = Number(stock.current_price);
  if (!Number.isFinite(price)) return;

  if (!stockHistories[sym]) seedHistoricalData(sym, price, tickTime);
  const hist = stockHistories[sym];
  hist.push({ time: tickTime, value: price });
  if (hist.length > 150) hist.shift();

  const prev = previousPrices[sym];
  const changed = prev !== undefined && price !== prev;
  let dir = lastDirection[sym] || 'up';
  if (prev !== undefined && price > prev) dir = 'up';
  else if (prev !== undefined && price < prev) dir = 'down';
  lastDirection[sym] = dir;

  // Watchlist
  const wlPrice = document.getElementById(`wl-price-${sym}`);
  if (wlPrice) {
    wlPrice.textContent = `₹${price.toFixed(2)}`;
    setDirectionClass(wlPrice, dir);
    if (changed) flash(wlPrice, dir);
  }
  const row = document.getElementById(`wl-${sym}`);
  const sub = document.getElementById(`wl-sub-${sym}`);
  const halted = stock.status && stock.status !== 'OPEN';
  if (row) row.classList.toggle('halted', !!halted);
  if (sub) sub.textContent = halted ? 'HALTED' : 'NSE EQUITIES';

  // Active chart
  if (activeStockSymbol === sym) {
    if (areaSeries) {
      try { areaSeries.update({ time: tickTime, value: price }); } catch (e) { console.error('chart update failed:', e); }
    }
    const pNode = document.getElementById('active-symbol-price');
    if (pNode) {
      pNode.textContent = `₹${price.toFixed(2)}`;
      setDirectionClass(pNode, dir);
      if (changed) flash(pNode, dir);
    }
    const dock = document.getElementById('dock-ltp');
    if (dock) dock.textContent = `₹${price.toFixed(2)}`;
  }

  previousPrices[sym] = price;
  currentPrices[sym] = price;
}

socket.on('price_update', (stocks) => {
  if (!Array.isArray(stocks) || stocks.length === 0) return;

  const tickTime = Math.max(lastTimeTick + 1, Math.floor(Date.now() / 1000));
  lastTimeTick = tickTime;

  ensureWatchlist(stocks, tickTime);

  stocks.forEach(stock => {
    try { applyTick(stock, tickTime); }
    catch (e) { console.error(`Tick failed for ${stock && stock.symbol}:`, e); }
  });

  calculateTotal();
  try { renderDashboardHoldings(); } catch (e) { console.error(e); }
});

socket.on('leaderboard_update', (leaderboard) => {
  const tbody = document.getElementById('leaderboard-rows');
  if (!tbody) return;
  tbody.innerHTML = '';
  leaderboard.forEach((player, idx) => {
    const tr = document.createElement('tr');
    if (currentUser && currentUser.id === player.id) tr.className = 'is-user';
    tr.innerHTML = `
      <td><span class="rank-badge">${idx + 1}</span></td>
      <td><strong>${player.name}</strong></td>
      <td>₹${Number(player.cash || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
      <td>₹${Number(player.portfolio_value || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
      <td style="font-weight: 700;">₹${Number((player.cash || 0) + (player.portfolio_value || 0)).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
    `;
    tbody.appendChild(tr);
  });
});

async function fetchUserPortfolio() {
  if (!currentUser) return;
  try {
    const res = await fetch(`/api/portfolio/${currentUser.id}`);
    if (res.ok) {
      const data = await res.json();
      if (data.user) {
        currentUser.cash = data.user.cash; currentUser.name = data.user.name;
        localStorage.setItem('vs_user', JSON.stringify(currentUser)); updateCashDisplay();
      }
      activeHoldings = (data.holdings || []).filter(h => h.qty > 0);
      renderDashboardHoldings();
    }
  } catch (e) {}
}

// IN-PLACE DASHBOARD RENDER (Prevents input fields from resetting during live ticks)
function renderDashboardHoldings() {
  if (!currentUser) return;
  const tbody = document.querySelector('#holdings-table tbody');
  if (!tbody) return;

  if (activeHoldings.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No open positions. Select a stock in the Trading Workspace to execute orders.</td></tr>';
    document.getElementById('dash-portfolio').textContent = `₹${Number(currentUser.cash).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
    const pnlNode = document.getElementById('dash-pnl');
    pnlNode.textContent = `₹0.00`;
    pnlNode.className = 'sc-value';
    return;
  }

  // Clear empty state message if positions exist
  const emptyState = tbody.querySelector('.empty-state');
  if (emptyState) tbody.innerHTML = '';

  let totalHoldingsVal = 0, totalPnL = 0;
  const activeSymbols = new Set(activeHoldings.map(h => h.symbol));

  // Remove rows for stocks that were completely sold off
  Array.from(tbody.querySelectorAll('tr[data-symbol]')).forEach(row => {
    if (!activeSymbols.has(row.dataset.symbol)) row.remove();
  });

  activeHoldings.forEach(h => {
    const ltp = currentPrices[h.symbol] || h.avg_cost;
    const curVal = h.qty * ltp;
    const pnl = curVal - (h.qty * h.avg_cost);
    totalHoldingsVal += curVal;
    totalPnL += pnl;

    let row = document.getElementById(`dash-row-${h.symbol}`);

    if (!row) {
      // Create new row
      row = document.createElement('tr');
      row.id = `dash-row-${h.symbol}`;
      row.dataset.symbol = h.symbol;
      row.innerHTML = `
        <td><strong>${h.symbol}</strong></td>
        <td id="dash-qty-owned-${h.symbol}">${h.qty}</td>
        <td>₹${h.avg_cost.toFixed(2)}</td>
        <td id="dash-ltp-${h.symbol}">₹${ltp.toFixed(2)}</td>
        <td id="dash-curval-${h.symbol}">₹${curVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td id="dash-pnl-${h.symbol}" class="${pnl >= 0 ? 'text-up' : 'text-down'}">${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}</td>
        <td>
          <div class="dash-action-group">
            <input type="number" id="dash-sell-qty-${h.symbol}" class="dash-qty-input" min="1" max="${h.qty}" value="${h.qty}">
            <button class="btn-sell-dash" onclick="sellSpecific('${h.symbol}', ${h.qty})">SELL</button>
          </div>
        </td>
      `;
      tbody.appendChild(row);
    } else {
      // Update numbers without rebuilding HTML so active typing remains uninterrupted
      const qtyOwnedEl = document.getElementById(`dash-qty-owned-${h.symbol}`);
      if (qtyOwnedEl) qtyOwnedEl.textContent = h.qty;

      const ltpEl = document.getElementById(`dash-ltp-${h.symbol}`);
      if (ltpEl) ltpEl.textContent = `₹${ltp.toFixed(2)}`;

      const curValEl = document.getElementById(`dash-curval-${h.symbol}`);
      if (curValEl) curValEl.textContent = `₹${curVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      const pnlEl = document.getElementById(`dash-pnl-${h.symbol}`);
      if (pnlEl) {
        pnlEl.textContent = `${pnl >= 0 ? '+' : ''}₹${pnl.toFixed(2)}`;
        pnlEl.className = pnl >= 0 ? 'text-up' : 'text-down';
      }

      const inputEl = document.getElementById(`dash-sell-qty-${h.symbol}`);
      if (inputEl) {
        inputEl.max = h.qty;
        if (parseInt(inputEl.value) > h.qty) inputEl.value = h.qty;
      }
    }
  });

  document.getElementById('dash-portfolio').textContent = `₹${(Number(currentUser.cash) + totalHoldingsVal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const pnlNode = document.getElementById('dash-pnl');
  pnlNode.textContent = `${totalPnL >= 0 ? '+' : ''}₹${totalPnL.toFixed(2)}`;
  pnlNode.className = `sc-value ${totalPnL >= 0 ? 'text-up' : 'text-down'}`;
}

socket.on('news_alert', (n) => {
  if (n && n.headline) showToast(n.symbol || 'NEWS', n.headline, Number(n.shock) >= 0);
});

function showToast(title, msg, isUp) {
  const container = document.getElementById('news-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${isUp ? 'text-up' : 'text-down'}`;
  toast.innerHTML = `<strong>${title}</strong><div style="font-size: 0.85rem; margin-top: 4px; color: #fff;">${msg}</div>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}