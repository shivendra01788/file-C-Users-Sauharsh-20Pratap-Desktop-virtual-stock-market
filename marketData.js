const db = require('../db');

// Expanded to 50 Real-World Stocks (NIFTY 50 + High Interest)
const INITIAL_STOCKS = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', p0: 2500.0 },
  { symbol: 'TCS', name: 'Tata Consultancy', p0: 3800.0 },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', p0: 1500.0 },
  { symbol: 'INFY', name: 'Infosys', p0: 1600.0 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', p0: 1100.0 },
  { symbol: 'SBIN', name: 'State Bank of India', p0: 800.0 },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', p0: 1750.0 },
  { symbol: 'AXISBANK', name: 'Axis Bank', p0: 1200.0 },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', p0: 1400.0 },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', p0: 6500.0 },
  { symbol: 'JIOFIN', name: 'Jio Financial Services', p0: 350.0 },
  { symbol: 'WIPRO', name: 'Wipro Limited', p0: 500.0 },
  { symbol: 'HCLTECH', name: 'HCL Technologies', p0: 1650.0 },
  { symbol: 'TECHM', name: 'Tech Mahindra', p0: 1300.0 },
  { symbol: 'LTIM', name: 'LTIMindtree', p0: 5500.0 },
  { symbol: 'ZOMATO', name: 'Zomato Ltd', p0: 250.0 },
  { symbol: 'PAYTM', name: 'One97 Communications', p0: 600.0 },
  { symbol: 'IRCTC', name: 'IRCTC', p0: 1000.0 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', p0: 950.0 },
  { symbol: 'M&M', name: 'Mahindra & Mahindra', p0: 1900.0 },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', p0: 11500.0 },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', p0: 4500.0 },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', p0: 4000.0 },
  { symbol: 'ITC', name: 'ITC Limited', p0: 450.0 },
  { symbol: 'HUL', name: 'Hindustan Unilever', p0: 2300.0 },
  { symbol: 'NESTLEIND', name: 'Nestle India', p0: 2500.0 },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', p0: 5000.0 },
  { symbol: 'TITAN', name: 'Titan Company', p0: 3700.0 },
  { symbol: 'DMART', name: 'Avenue Supermarts', p0: 4800.0 },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', p0: 2800.0 },
  { symbol: 'SUNPHARMA', name: 'Sun Pharma', p0: 1400.0 },
  { symbol: 'DRREDDY', name: 'Dr Reddys Labs', p0: 6000.0 },
  { symbol: 'CIPLA', name: 'Cipla Limited', p0: 1400.0 },
  { symbol: 'NTPC', name: 'NTPC Limited', p0: 320.0 },
  { symbol: 'POWERGRID', name: 'Power Grid Corp', p0: 280.0 },
  { symbol: 'ONGC', name: 'ONGC', p0: 300.0 },
  { symbol: 'TATAPOWER', name: 'Tata Power', p0: 420.0 },
  { symbol: 'COALINDIA', name: 'Coal India', p0: 450.0 },
  { symbol: 'LT', name: 'Larsen & Toubro', p0: 3500.0 },
  { symbol: 'HAL', name: 'Hindustan Aeronautics', p0: 4500.0 },
  { symbol: 'TATASTEEL', name: 'Tata Steel', p0: 150.0 },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', p0: 850.0 },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', p0: 650.0 },
  { symbol: 'VEDL', name: 'Vedanta Limited', p0: 450.0 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', p0: 1200.0 },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', p0: 9800.0 },
  { symbol: 'GRASIM', name: 'Grasim Industries', p0: 2200.0 },
  { symbol: 'AMBUJACEM', name: 'Ambuja Cements', p0: 600.0 },
  { symbol: 'ADANIENT', name: 'Adani Enterprises', p0: 3100.0 },
  { symbol: 'ADANIPORTS', name: 'Adani Ports', p0: 1300.0 }
];

function initializeStocks() {
  INITIAL_STOCKS.forEach(stock => {
    db.run(
      `INSERT OR IGNORE INTO stocks (symbol, name, p0, current_price, status) VALUES (?, ?, ?, ?, 'OPEN')`,
      [stock.symbol, stock.name, stock.p0, stock.p0],
      (err) => {
        if (err) console.error("Error setting stock", err);
      }
    );
  });
}

module.exports = { INITIAL_STOCKS, initializeStocks };