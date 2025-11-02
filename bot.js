// bot.js — ИСПРАВЛЕННАЯ ВЕРСИЯ
const WebSocketManager = require('./websocketManager');
const OrderManager = require('./orderManager');
const config = require('./config');
const { EventEmitter } = require('events');

class TradingBot extends EventEmitter {
  constructor() {
    super();
    this.wsManager = new WebSocketManager();
    this.opened = new Set();
    this.latestPrice = null; // Храним последнюю цену
  }

  async start() {
    await OrderManager.setHedgeMode();
    for (const symbol of config.symbols) {
      await OrderManager.setLeverage(symbol);
    }

    this.wsManager.startMonitoring();
    this.wsManager.on('priceUpdate', this.handlePriceUpdate.bind(this));

    console.log('Бот запущен — ждём цену...');
  }

  async handlePriceUpdate({ symbol, price }) {
    this.latestPrice = price;

    if (this.opened.has(symbol)) return;

    console.log(`\n[СИГНАЛ] Открываем хедж по текущей цене: ${price}`);
    
    await Promise.all([
      OrderManager.openPosition(symbol, 'BUY', config.positionSize, price),
      OrderManager.openPosition(symbol, 'SELL', config.positionSize, price),
    ]);

    this.opened.add(symbol);
  }

  async stop() {
    this.wsManager.stop();
    console.log('Бот остановлен');
  }
}

module.exports = TradingBot;