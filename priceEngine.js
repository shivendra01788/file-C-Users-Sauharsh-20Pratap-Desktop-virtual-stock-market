// Gaussian random helper for smoothing noise
function gaussian(mean = 0, stdev = 1) {
  let u = 1 - Math.random();
  let v = Math.random();
  let z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return z * stdev + mean;
}

function computeNextPrice(currentPrice, targetPrice, p0, multiplier = 20) {
  // Clamp target price within floor (5% of P0) and ceiling (5x P0)
  const floor = 0.05 * p0;
  const ceiling = 5.0 * p0;
  let clampedTarget = Math.max(floor, Math.min(ceiling, targetPrice));

  // Smooth movement toward target + gaussian noise
  let next = currentPrice + (clampedTarget - currentPrice) * 0.25 + currentPrice * gaussian(0, 0.002);
  
  return Math.max(floor, Math.min(ceiling, next));
}

function applyMultiplier(rawPrice, p0, multiplier = 20) {
  return p0 * (1 + multiplier * (rawPrice / p0 - 1));
}

module.exports = { computeNextPrice, applyMultiplier };