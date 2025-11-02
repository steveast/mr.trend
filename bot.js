// bot.js
const WebSocketManager = require('./websocketManager');
const OrderManager = require('./orderManager');
const config = require('./config');

class TradingBot {
  constructor() {
    this.wsManager = new WebSocketManager();
    this.active = false;
    this.entryPrice = null;
    this.longSL = null;
    this.shortSL = null;
    this.symbol = config.symbols[0];
    this.firstTPTaken = { LONG: false, SHORT: false };
  }

  async start() {
    await OrderManager.setHedgeMode();
    for (const symbol of config.symbols) {
      await OrderManager.setLeverage(symbol);
    }

    this.wsManager.startMonitoring();
    this.wsManager.on('priceUpdate', this.handlePrice.bind(this));
    this.wsManager.on('orderFilled', this.handleOrderFilled.bind(this));

    this.wsManager.once('priceUpdate', async ({ price }) => {
      this.entryPrice = price;
      console.log(`\n[ВХОД] Хедж по цене: ${price.toFixed(2)}`);

      const qty = config.positionSize;
      this.longSL = price * 0.98;
      this.shortSL = price * 1.02;

      try {
        // 1. ПОЛУЧАЕМ ТЕКУЩУЮ ЦЕНУ
        const currentPrice = await OrderManager.getCurrentPrice(this.symbol);
        if (!currentPrice) {
          console.error('Не удалось получить текущую цену');
          return;
        }

        await Promise.all([
          OrderManager.openMarketPosition(this.symbol, 'BUY', qty, 'LONG'),
          OrderManager.openMarketPosition(this.symbol, 'SELL', qty, 'SHORT'),
        ]);

        // 4. ЖДЁМ 1 СЕКУНДУ
        await new Promise(r => setTimeout(r, 1000));

        // 5. СТАВИМ СТОПЫ
        await Promise.all([
          OrderManager.placeStopLoss(this.symbol, 'BUY', qty, this.longSL, 'LONG'),
          OrderManager.placeStopLoss(this.symbol, 'SELL', qty, this.shortSL, 'SHORT'),
        ]);
        console.log('Стопы выставлены');

        // 6. ЖДЁМ 1 СЕКУНДУ
        await new Promise(r => setTimeout(r, 1000));

        // 7. СТАВИМ ТЕЙКИ
        await Promise.all([
          OrderManager.placeTakeProfits(this.symbol, 'BUY', qty, currentPrice, this.longSL, 'LONG'),
          OrderManager.placeTakeProfits(this.symbol, 'SELL', qty, currentPrice, this.shortSL, 'SHORT'),
        ]);
        console.log('Грид тейков выставлен (20 ордеров)');

      } catch (err) {
        console.error('Критическая ошибка при открытии:', err.message);
        return;
      }

      this.active = true;
    });

    console.log('Бот запущен — ждём первую цену...');
  }

  async handlePrice({ symbol, price }) {
    if (!this.active || symbol !== this.symbol) return;

    if (price <= this.longSL) {
      console.log(`\n[STOP] LONG сработал → SL SHORT в безубыток`);
      await OrderManager.moveSLToBreakeven(this.symbol, 'SHORT', this.entryPrice);
      this.active = false;
    }

    if (price >= this.shortSL) {
      console.log(`\n[STOP] SHORT сработал → SL LONG в безубыток`);
      await OrderManager.moveSLToBreakeven(this.symbol, 'LONG', this.entryPrice);
      this.active = false;
    }
  }

  async handleOrderFilled({ symbol, side, positionSide, price }) {
    if (!this.active || symbol !== this.symbol) return;

    const isTP = (positionSide === 'LONG' && side === 'SELL') ||
                 (positionSide === 'SHORT' && side === 'BUY');

    if (isTP && !this.firstTPTaken[positionSide]) {
      console.log(`\n[TP1] ${positionSide} по ${price.toFixed(2)} → SL в безубыток`);
      this.firstTPTaken[positionSide] = true;
      const opposite = positionSide === 'LONG' ? 'SHORT' : 'LONG';
      await OrderManager.moveSLToBreakeven(this.symbol, opposite, this.entryPrice);
    }
  }

  async stop() {
    this.wsManager.stop();
    console.log('Бот остановлен');
  }
}

module.exports = TradingBot;