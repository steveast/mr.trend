// orderManager.js
const config = require('./config');
const crypto = require('crypto');

const BASE_URL = config.testnet 
  ? 'https://testnet.binancefuture.com' 
  : 'https://fapi.binance.com';

const signedRequest = async (method, endpoint, params = {}) => {
  const url = `${BASE_URL}${endpoint}`;
  const queryParams = { ...params, timestamp: Date.now() };
  const queryString = new URLSearchParams(queryParams).toString();
  const signature = crypto
    .createHmac('sha256', config.apiSecret)
    .update(queryString)
    .digest('hex');

  const fullUrl = `${url}?${queryString}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': config.apiKey };

  const response = await fetch(fullUrl, { method, headers });
  const data = await response.json();

  if (data.code && data.code !== 200) {
    throw new Error(`${data.code}: ${data.msg}`);
  }
  return data;
};

class OrderManager {
  static async setHedgeMode() {
    try {
      await signedRequest('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: true });
      console.log('Hedge mode включён');
    } catch (err) {
      if (err.message.includes('200') || err.message.includes('-4059')) {
        console.log('Hedge mode уже активен');
      } else {
        console.error('Ошибка hedge mode:', err.message);
      }
    }
  }

  static async setLeverage(symbol) {
    try {
      await signedRequest('POST', '/fapi/v1/leverage', {
        symbol,
        leverage: config.leverage,
      });
      console.log(`Плечо ${config.leverage}x для ${symbol}`);
    } catch (err) {
      console.error(`Ошибка плеча ${symbol}:`, err.message);
    }
  }

  static async openPosition(symbol, side, quantity, entryPrice) {
    const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';

    try {
      const order = await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(6),
        positionSide, // КЛЮЧЕВОЙ ПАРАМЕТР
      });

      console.log(`Открыто: ${positionSide} ${quantity} ${symbol} @ ${entryPrice.toFixed(2)}`);

      await this.setStopLoss(symbol, side, quantity, entryPrice, positionSide);
      await this.setTakeProfit(symbol, side, quantity, entryPrice, positionSide);

      return order;
    } catch (err) {
      console.error(`Ошибка ${positionSide} ${symbol}:`, err.message);
    }
  }

  static async setStopLoss(symbol, side, quantity, entryPrice, positionSide) {
    const slPrice = side === 'BUY'
      ? entryPrice * (1 + config.stopLossPct / 100)
      : entryPrice * (1 - config.stopLossPct / 100);

    try {
      await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side: side === 'BUY' ? 'SELL' : 'BUY',
        type: 'STOP_MARKET',
        quantity: quantity.toFixed(6),
        stopPrice: slPrice.toFixed(2),
        positionSide,
        closePosition: false,
      });
      console.log(`SL ${positionSide}: ${slPrice.toFixed(2)}`);
    } catch (err) {
      console.error(`Ошибка SL ${positionSide}:`, err.message);
    }
  }

  static async setTakeProfit(symbol, side, quantity, entryPrice, positionSide) {
    const tpPrice = side === 'BUY'
      ? entryPrice * (1 + config.takeProfitPct / 100)
      : entryPrice * (1 - config.takeProfitPct / 100);

    try {
      await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side: side === 'BUY' ? 'SELL' : 'BUY',
        type: 'TAKE_PROFIT_MARKET',
        quantity: quantity.toFixed(6),
        stopPrice: tpPrice.toFixed(2),
        positionSide,
        closePosition: false,
      });
      console.log(`TP ${positionSide}: ${tpPrice.toFixed(2)}`);
    } catch (err) {
      console.error(`Ошибка TP ${positionSide}:`, err.message);
    }
  }
}

module.exports = OrderManager;