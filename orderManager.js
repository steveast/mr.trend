// orderManager.js
const config = require('./config');
const crypto = require('crypto');

if (!global.fetch) {
  global.fetch = require('node-fetch');
}

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

  if (data.code) {
    throw new Error(`${data.code}: ${data.msg}`);
  }
  return data;
};

const TICK_SIZE = {};

async function initTickSize() {
  try {
    const data = await signedRequest('GET', '/fapi/v1/exchangeInfo');
    data.symbols.forEach(s => {
      if (config.symbols.includes(s.symbol)) {
        s.filters.forEach(f => {
          if (f.filterType === 'PRICE_FILTER') {
            TICK_SIZE[s.symbol] = parseFloat(f.tickSize);
          }
        });
      }
    });
    console.log('TickSize загружен:', TICK_SIZE);
  } catch (err) {
    console.error('Ошибка загрузки tickSize:', err.message);
  }
}

initTickSize();

function roundToTick(price, symbol = 'BTCUSDT') {
  const tick = TICK_SIZE[symbol] || 0.1;
  return Math.round(price / tick) * tick;
}

class OrderManager {
  static async setHedgeMode() {
    try {
      await signedRequest('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: true });
      console.log('Hedge mode включён');
    } catch (err) {
      if (err.message.includes('-4059')) {
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

  // НОВАЯ ФУНКЦИЯ: ПОЛУЧИТЬ ТЕКУЩУЮ ЦЕНУ
  static async getCurrentPrice(symbol) {
    try {
      const ticker = await signedRequest('GET', '/fapi/v1/ticker/price', { symbol });
      return parseFloat(ticker.price);
    } catch (err) {
      console.error('Ошибка получения цены:', err.message);
      return 110000; // fallback
    }
  }

  // ОТКРЫВАЕМ ПОЗИЦИЮ: LIMIT + IOC = MARKET + positionSide
  static async openMarketPosition(symbol, side, quantity, positionSide) {
    try {
      const currentPrice = await this.getCurrentPrice(symbol);
      const price = roundToTick(
        currentPrice * (side === 'BUY' ? 1.001 : 0.999),
        symbol
      );

      const order = await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side,
        type: 'LIMIT',
        quantity: quantity.toFixed(6),
        price: price.toFixed(2),
        timeInForce: 'IOC',
        positionSide,
      });
      console.log(`Открыто: ${positionSide} @ ${price.toFixed(2)}`);
      return order;
    } catch (err) {
      console.error(`Ошибка открытия ${positionSide}:`, err.message);
      throw err;
    }
  }

  // СТАВИМ СТОПЫ
  static async placeStopLoss(symbol, side, quantity, stopPrice, positionSide) {
    const tpSide = side === 'BUY' ? 'SELL' : 'BUY';
    const roundedStop = roundToTick(stopPrice, symbol);
    try {
      await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side: tpSide,
        type: 'STOP_MARKET',
        quantity: quantity.toFixed(6),
        stopPrice: roundedStop.toFixed(2),
        positionSide,
      });
      console.log(`SL ${positionSide}: ${roundedStop.toFixed(2)}`);
    } catch (err) {
      console.error(`Ошибка SL ${positionSide}:`, err.message);
    }
  }

  // СТАВИМ 10 ТЕЙКОВ
  static async placeTakeProfits(symbol, side, quantity, entryPrice, stopPrice, positionSide) {
    const isLong = side === 'BUY';
    const tpSide = isLong ? 'SELL' : 'BUY';
    const distance = Math.abs(entryPrice - stopPrice);
    const step = distance * 0.1;

    for (let i = 1; i <= 10; i++) {
      const tpPrice = roundToTick(
        isLong 
          ? entryPrice - (step * i)
          : entryPrice + (step * i),
        symbol
      );

      const params = {
        symbol,
        side: tpSide,
        type: 'LIMIT',
        quantity: quantity.toFixed(6),
        price: tpPrice.toFixed(2),
        timeInForce: 'GTC',
        positionSide,
      };

      if (i === 10) {
        params.reduceOnly = true;
      }

      try {
        await signedRequest('POST', '/fapi/v1/order', params);
        console.log(`TP${i} ${isLong ? 'LONG' : 'SHORT'}: ${tpPrice.toFixed(2)}${i===10 ? ' (close)' : ''}`);
      } catch (err) {
        console.error(`Ошибка TP${i} ${positionSide}:`, err.message);
      }
    }
  }

  static async moveSLToBreakeven(symbol, positionSide, entryPrice) {
    const side = positionSide === 'LONG' ? 'SELL' : 'BUY';
    const stopPrice = roundToTick(entryPrice, symbol);

    try {
      await signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
      await signedRequest('POST', '/fapi/v1/order', {
        symbol,
        side,
        type: 'STOP_MARKET',
        quantity: config.positionSize.toFixed(6),
        stopPrice: stopPrice.toFixed(2),
        positionSide,
        reduceOnly: true,
      });
      console.log(`SL ${positionSide} → безубыток: ${stopPrice.toFixed(2)}`);
    } catch (err) {
      console.error(`Ошибка безубытка:`, err.message);
    }
  }
}

module.exports = OrderManager;