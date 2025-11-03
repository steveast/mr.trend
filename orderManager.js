// orderManager.js
const config = require('./config');
const crypto = require('crypto');

if (!global.fetch) {
  global.fetch = require('node-fetch');
}

const BASE_URL = config.testnet 
  ? 'https://testnet.binancefuture.com' 
  : 'https://fapi.binance.com';

class OrderManager {
  // === ПОДПИСАННЫЙ ЗАПРОС — В КЛАССЕ ===
  static async signedRequest(method, endpoint, params = {}) {
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
  }

  // === TICK SIZE ===
  static TICK_SIZE = {};

  static async initTickSize() {
    try {
      const data = await this.signedRequest('GET', '/fapi/v1/exchangeInfo');
      data.symbols.forEach(s => {
        if (config.symbols.includes(s.symbol)) {
          s.filters.forEach(f => {
            if (f.filterType === 'PRICE_FILTER') {
              this.TICK_SIZE[s.symbol] = parseFloat(f.tickSize);
            }
          });
        }
      });
      console.log('TickSize загружен:', this.TICK_SIZE);
    } catch (err) {
      console.error('Ошибка загрузки tickSize:', err.message);
    }
  }

  static roundToTick(price, symbol = 'BTCUSDT') {
    const tick = this.TICK_SIZE[symbol] || 0.1;
    return Math.round(price / tick) * tick;
  }

  // === HEDGE MODE ===
  static async setHedgeMode() {
    try {
      await this.signedRequest('POST', '/fapi/v1/positionSide/dual', { dualSidePosition: true });
      console.log('Hedge mode включён');
    } catch (err) {
      if (err.message.includes('-4059')) {
        console.log('Hedge mode уже активен');
      } else {
        console.error('Ошибка hedge mode:', err.message);
      }
    }
  }

  // === LEVERAGE ===
  static async setLeverage(symbol) {
    try {
      await this.signedRequest('POST', '/fapi/v1/leverage', {
        symbol,
        leverage: config.leverage,
      });
      console.log(`Плечо ${config.leverage}x для ${symbol}`);
    } catch (err) {
      console.error(`Ошибка плеча ${symbol}:`, err.message);
    }
  }

  // === ТЕКУЩАЯ ЦЕНА ===
  static async getCurrentPrice(symbol) {
    try {
      const ticker = await this.signedRequest('GET', '/fapi/v1/ticker/price', { symbol });
      return parseFloat(ticker.price);
    } catch (err) {
      console.error('Ошибка получения цены:', err.message);
      return 110000;
    }
  }

  // === ОТКРЫТИЕ ПОЗИЦИИ (LIMIT + IOC) ===
  static async openMarketPosition(symbol, side, quantity, positionSide) {
    try {
      const currentPrice = await this.getCurrentPrice(symbol);
      const price = this.roundToTick(
        currentPrice * (side === 'BUY' ? 1.001 : 0.999),
        symbol
      );

      const order = await this.signedRequest('POST', '/fapi/v1/order', {
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

  // === СТОПЫ ===
  static async placeStopLoss(symbol, side, quantity, stopPrice, positionSide) {
    const tpSide = side === 'BUY' ? 'SELL' : 'BUY';
    const roundedStop = this.roundToTick(stopPrice, symbol);
    try {
      await this.signedRequest('POST', '/fapi/v1/order', {
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

  // === ТЕЙКИ ОТ СТОПА ===
  static async placeTakeProfits(symbol, allQuantity, entryPrice, stopPrice, positionSide) {
    const isLong = positionSide === 'LONG';
    const tpSide = isLong ? 'SELL' : 'BUY';
    const distance = Math.abs(entryPrice - stopPrice);
    const step = distance * 0.1;
    const quantity =  allQuantity / 10;
    
    for (let i = 1; i <= 10; i++) {
      const tpPrice = this.roundToTick(
        isLong 
          ? stopPrice + (step * i)
          : stopPrice - (step * i),
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
        params.quantity = allQuantity;
      }

      try {
        await this.signedRequest('POST', '/fapi/v1/order', params);
        console.log(`TP${i} ${isLong ? 'LONG' : 'SHORT'}: ${tpPrice.toFixed(2)}${i===10 ? ' (close)' : ''}`);
      } catch (err) {
        console.error(`Ошибка TP${i} ${positionSide}:`, err.message);
      }
    }
  }

  // === БЕЗУБЫТОК ===
  static async moveSLToBreakeven(symbol, positionSide, entryPrice) {
    const side = positionSide === 'LONG' ? 'SELL' : 'BUY';
    const stopPrice = this.roundToTick(entryPrice, symbol);

    try {
      // await this.signedRequest('DELETE', '/fapi/v1/allOpenOrders', { symbol });
      await this.signedRequest('POST', '/fapi/v1/order', {
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

// ИНИЦИАЛИЗАЦИЯ
OrderManager.initTickSize();

module.exports = OrderManager;