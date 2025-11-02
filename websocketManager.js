// websocketManager.js
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
      const stream = this.client.ws.futuresTicker(symbol, ticker => {
        const price = parseFloat(ticker.close); // ИСПРАВЛЕНО: close — всегда есть
        if (isNaN(price)) return;

        this.emit('priceUpdate', { symbol, price, time: Date.now() });
        console.log(`[${symbol}] Цена: ${price}`);
      });

      this.subscriptions.set(symbol, stream);
    });

    console.log(`WebSocket: мониторим ${config.symbols.join(', ')}`);
  }

  stop() {
    this.subscriptions.forEach(unsub => unsub());
    this.subscriptions.clear();
    console.log('WebSocket отключён');
  }
}

module.exports = WebSocketManager;