// bot.js — ТЕЙКИ СРАЗУ ПОСЛЕ ВХОДА
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
    this.gridCreated = { LONG: false, SHORT: false };
    this.firstTPTaken = { LONG: false, SHORT: false };
  }

  async start() {
    await OrderManager.setHedgeMode();
    for (const symbol of config.symbols) {
      await OrderManager.setLeverage(symbol);
    }

    this.wsManager.startMonitoring();
    this.wsManager.on('priceUpdate', this.handlePrice.bind(this));

    this.wsManager.once('priceUpdate', async ({ price }) => {
      this.entryPrice = price;
      console.log(`\n[ВХОД] Хедж по цене: ${price.toFixed(2)}`);

      const qty = config.positionSize;
      this.longSL = price * 0.98;
      this.shortSL = price * 1.02;

      // ОТКРЫВАЕМ ПОЗИЦИИ + СРАЗУ ТЕЙКИ
      await Promise.all([
        this.openWithGrid('BUY', qty, price, this.longSL, 'LONG'),
        this.openWithGrid('SELL', qty, price, this.shortSL, 'SHORT'),
      ]);
      this.wsManager.on('orderFilled', this.handleOrderFilled.bind(this));

      this.active = true;
    });

    console.log('Бот запущен — тейки выставляются СРАЗУ');
  }

  async openWithGrid(side, qty, entry, stop, positionSide) {
    await OrderManager.openPositionWithSL(this.symbol, side, qty, entry, stop);
    await OrderManager.createGridTakeProfits(this.symbol, side, qty, entry, stop);
    this.gridCreated[positionSide] = true;
    console.log(`Грид ${positionSide} создан сразу после входа`);
  }

  async handlePrice({ symbol, price }) {
    if (!this.active || symbol !== this.symbol) return;

    // СРАБАТЫВАНИЕ СТОПА
    if (price <= this.longSL && !this.gridCreated.SHORT) {
      console.log(`\n[STOP] LONG сработал — SHORT уже с гридом`);
      await OrderManager.moveSLToBreakeven(this.symbol, 'SHORT', this.entryPrice);
      this.active = false;
    }

    if (price >= this.shortSL && !this.gridCreated.LONG) {
      console.log(`\n[STOP] SHORT сработал — LONG уже с гридом`);
      await OrderManager.moveSLToBreakeven(this.symbol, 'LONG', this.entryPrice);
      this.active = false;
    }
  }

  async stop() {
    this.wsManager.stop();
    console.log('Бот остановлен');
  }

  async handleOrderFilled({ symbol, side, positionSide, price, qty }) {
    if (!this.active || symbol !== this.symbol) return;

    const isLongTP = positionSide === 'LONG' && side === 'SELL';
    const isShortTP = positionSide === 'SHORT' && side === 'BUY';

    if ((isLongTP || isShortTP) && !this.firstTPTaken[positionSide]) {
      console.log(`\n[TP1] Первый тейк ${positionSide} по ${price.toFixed(2)} → SL в безубыток!`);
      this.firstTPTaken[positionSide] = true;

      const oppositeSide = positionSide === 'LONG' ? 'SHORT' : 'LONG';
      await OrderManager.moveSLToBreakeven(this.symbol, oppositeSide, this.entryPrice);
    }
  }
}

module.exports = TradingBot;