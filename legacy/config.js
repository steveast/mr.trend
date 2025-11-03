require('dotenv').config();

module.exports = {
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  testnet: process.env.TESTNET === 'true',
  symbols: process.env.SYMBOLS.split(',').map(s => s.trim()),
  leverage: parseInt(process.env.LEVERAGE) || 10,
  positionSize: parseFloat(process.env.POSITION_SIZE) || 0.001,
  stopLossPct: parseFloat(process.env.STOP_LOSS_PCT) || -2,
  takeProfitPct: parseFloat(process.env.TAKE_PROFIT_PCT) || 5,
};
