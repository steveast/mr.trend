// orderManager.js
const config = require('./config');
const crypto = require('crypto');

const BASE_URL = config.testnet 
  ? 'https://testnet.binancefuture.com' 
  : 'https://fapi.binance.com';

const signedRequest = async (method, endpoint, params = {}) => {
  const url = `${config.testnet ? 'https://testnet.binancefuture.com' : 'https://fapi.binance.com'}${endpoint}`;
  const query = new URLSearchParams({ ...params, timestamp: Date.now() }).toString();
  const signature = require('crypto')
    .createHmac('sha256', config.apiSecret)
    .update(query)
    .digest('hex');

  const fullUrl = `${url}?${query}&signature=${signature}`;
  const headers = { 'X-MBX-APIKEY': config.apiKey };

  const response = await fetch(fullUrl, { method, headers });
  const data = await response.json();
  if (data.code) throw new Error(`${data.code}: ${data.msg}`);
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

  // orderManager.js — ИСПРАВЛЕНО
  static async createGridTakeProfits(symbol, side, quantity, entryPrice, stopPrice) {
    const distance = Math.abs(entryPrice - stopPrice);
    const step = distance * 0.1;

    const isLong = side === 'BUY';
    const tpSide = isLong ? 'SELL' : 'BUY';
    const startPrice = isLong ? stopPrice : stopPrice;

    for (let i = 1; i <= 10; i++) {
      const tpPrice = isLong 
        ? startPrice + (step * i)
        : startPrice - (step * i);

      const reduceOnly = i === 10; // ТОЛЬКО НА ПОСЛЕДНЕМ

      try {
        await signedRequest('POST', '/fapi/v1/order', {
          symbol,
          side: tpSide,
          type: 'LIMIT',
          quantity: quantity.toFixed(6),
          price: tpPrice.toFixed(2),
          timeInForce: 'GTC',
          reduceOnly, // ТОЛЬКО НА TP10
          positionSide: isLong ? 'LONG' : 'SHORT',
        });
        console.log(`TP${i} ${isLong ? 'LONG' : 'SHORT'}: ${tpPrice.toFixed(2)}${reduceOnly ? ' (close)' : ''}`);
      } catch (err) {
        console.error(`Ошибка TP${i}:`, err.message);
      }
    }
  }

  // В orderManager.js — добавь эти методы

  static async openPositionWithSL(symbol, side, quantity, entryPrice, stopPrice) {
    const positionSide = side === 'BUY' ? 'LONG' : 'SHORT';
    try {
      await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(6),
        positionSide,
      });
      console.log(`Открыто: ${positionSide} @ ${entryPrice.toFixed(2)} | SL: ${stopPrice.toFixed(2)}`);

      // Устанавливаем SL
      await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side: side === 'BUY' ? 'SELL' : 'BUY',
        type: 'STOP_MARKET',
        quantity: quantity.toFixed(6),
        stopPrice: stopPrice.toFixed(2),
        positionSide,
        closePosition: false,
      });
    } catch (err) {
      console.error(`Ошибка ${positionSide}:`, err.message);
    }
  }

  static async moveSLToBreakeven(symbol, positionSide, breakevenPrice) {
    try {
      await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side: positionSide === 'LONG' ? 'SELL' : 'BUY',
        type: 'STOP_MARKET',
        quantity: config.positionSize.toFixed(6),
        stopPrice: breakevenPrice.toFixed(2),
        positionSide,
        closePosition: false,
      });
      console.log(`SL ${positionSide} → безубыток: ${breakevenPrice.toFixed(2)}`);
    } catch (err) {
      console.error(`Ошибка безубытка:`, err.message);
    }
  }
}

module.exports = OrderManager;