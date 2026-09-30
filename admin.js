document.addEventListener('DOMContentLoaded', fetchAdminState);

async function fetchAdminState() {
  const res = await fetch('/api/admin/state');
  const data = await res.json();
  
  // Update Top Badge
  const statusEl = document.getElementById('market-status');
  if (data.trading_open === 'true') {
    statusEl.textContent = '🟢 LIVE & TRADING';
    statusEl.className = 'status-badge badge-open';
  } else {
    statusEl.textContent = '🔴 PAUSED (FROZEN)';
    statusEl.className = 'status-badge badge-closed';
  }

  // Populate Dropdown and Table
  const tbody = document.querySelector('#admin-stocks-table tbody');
  const select = document.getElementById('news-symbol');
  tbody.innerHTML = '';
  select.innerHTML = '<option value="">-- Select Target Stock --</option>';

  data.stocks.forEach(stock => {
    const opt = document.createElement('option');
    opt.value = stock.symbol;
    opt.textContent = stock.symbol;
    select.appendChild(opt);

    const tr = document.createElement('tr');
    const isHalted = stock.status === 'HALTED';
    const statusColor = isHalted ? 'color: var(--down-color);' : 'color: var(--up-color);';
    
    tr.innerHTML = `
      <td><strong style="color: #fff;">${stock.symbol}</strong></td>
      <td style="${statusColor} font-weight: 600;">${stock.status}</td>
      <td style="text-align: right;">
        ${isHalted 
          ? `<button onclick="toggleHalt('${stock.symbol}', 'OPEN')" class="btn-b" style="padding: 8px 16px;">RESUME</button>` 
          : `<button onclick="toggleHalt('${stock.symbol}', 'HALTED')" class="btn-s" style="padding: 8px 16px;">HALT</button>`}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function toggleMarket(action) {
  await fetch('/api/admin/trading', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
  fetchAdminState();
}

async function toggleHalt(symbol, newStatus) {
  await fetch('/api/admin/halt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbol, status: newStatus }) });
  fetchAdminState();
}

async function publishNews() {
  const symbol = document.getElementById('news-symbol').value;
  const headline = document.getElementById('news-headline').value;
  const shock = document.getElementById('news-shock').value;
  
  if (!symbol || !headline || !shock) return alert('Fill out all fields to deploy shock.');
  
  const res = await fetch('/api/admin/news', { 
    method: 'POST', 
    headers: { 'Content-Type': 'application/json' }, 
    body: JSON.stringify({ symbol, headline, shock }) 
  });
  
  if (res.ok) { 
    alert('SHOCK DEPLOYED SUCCESSFULLY!'); 
    document.getElementById('news-headline').value = ''; 
    document.getElementById('news-shock').value = ''; 
  }
}