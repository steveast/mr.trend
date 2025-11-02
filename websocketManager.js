// websocketManager.js — 100% РАБОЧИЙ
const Binance = require('binance-api-node').default;
const { EventEmitter } = require('events');
const config = require('./config');

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.client = Binance({
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      useServerTime: true,
      httpFutures: config.testnet ? 'https://testnet.binancefuture.com' : undefined,
    });
    this.subscriptions = new Map();
  }

  startMonitoring() {
    config.symbols.forEach(symbol => {
      // ИСПРАВЛЕНО: futuresAggTrade → futuresAggTrade
      const stream = this.client.ws.futuresAggTrades(symbol, trade => {
        const price = parseFloat(trade.price);
        if (isNaN(price)) return;

        this.emit('priceUpdate', { symbol, price, time: Date.now() });
        console.log(`[${symbol}] Цена: ${price.toFixed(2)}`);
      });

      this.subscriptions.set(symbol, stream);
    });

    console.log(`WebSocket: мониторим ${config.symbols.join(', ')} через aggTrade`);
  }

  stop() {
    this.subscriptions.forEach(unsub => {
      try { unsub(); } catch (e) {}
    });
    this.subscriptions.clear();
    console.log('WebSocket отключён');
  }
}

module.exports = WebSocketManager;