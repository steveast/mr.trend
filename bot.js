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
    this.positionsClosed = { LONG: false, SHORT: false }; // ← НОВОЕ
  }

  async start() {
    await OrderManager.setHedgeMode();
    for (const symbol of config.symbols) {
      await OrderManager.setLeverage(symbol);
    }

    this.wsManager.startMonitoring();
    this.wsManager.on('priceUpdate', this.handlePrice.bind(this));
    this.wsManager.on('orderFilled', this.handleOrderFilled.bind(this));

    // Запускаем первый вход
    this.restartEntry();
    console.log('Бот запущен — ждём вход...');
  }

  // === НОВЫЙ ВХОД ПО ТЕКУЩЕЙ ЦЕНЕ ===
  async restartEntry() {
    if (this.active) return;

    const price = await OrderManager.getCurrentPrice(this.symbol);
    this.entryPrice = price;
    this.firstTPTaken = { LONG: false, SHORT: false };
    this.positionsClosed = { LONG: false, SHORT: false };

    console.log(`\n[НОВЫЙ ЦИКЛ] Хедж по цене: ${price.toFixed(2)}`);

    const qty = config.positionSize;
    this.longSL = price * 0.98;
    this.shortSL = price * 1.02;

    try {
      // 1. Открываем позиции
      await Promise.all([
        OrderManager.openMarketPosition(this.symbol, 'BUY', qty, 'LONG'),
        OrderManager.openMarketPosition(this.symbol, 'SELL', qty, 'SHORT'),
      ]);

      await new Promise(r => setTimeout(r, 300));

      // 2. Стопы
      await Promise.all([
        OrderManager.placeStopLoss(this.symbol, 'BUY', qty, this.longSL, 'LONG'),
        OrderManager.placeStopLoss(this.symbol, 'SELL', qty, this.shortSL, 'SHORT'),
      ]);

      await new Promise(r => setTimeout(r, 200));

      // 3. Тейки
      await Promise.all([
        OrderManager.placeTakeProfits(this.symbol, qty, price, this.shortSL, 'LONG'),
        OrderManager.placeTakeProfits(this.symbol, qty, price, this.longSL, 'SHORT'),
      ]);

      this.active = true;
      console.log('Новый цикл запущен: позиции, стопы, тейки — всё на месте.');

    } catch (err) {
      console.error('Ошибка при новом входе:', err.message);
      setTimeout(() => this.restartEntry(), 5000);
    }
  }

  // === ОТСЛЕЖИВАНИЕ ЗАКРЫТИЯ ПОЗИЦИЙ ===
  async handleOrderFilled({ symbol, side, positionSide, price, quantity }) {
    if (symbol !== this.symbol || !this.active) return;

    // Проверяем, закрылась ли позиция полностью
    const position = await this.getPosition(positionSide);
    const remaining = Math.abs(parseFloat(position.positionAmt));

    if (remaining < 0.00001) { // ~0
      if (!this.positionsClosed[positionSide]) {
        console.log(`[ЗАКРЫТА] ${positionSide} позиция`);
        this.positionsClosed[positionSide] = true;
      }
    }

    // === ПЕРВЫЙ ТЕЙК → БЕЗУБЫТОК ОППОНЕНТА ===
    const isTP = (positionSide === 'LONG' && side === 'SELL') ||
                 (positionSide === 'SHORT' && side === 'BUY');

    if (isTP && !this.firstTPTaken[positionSide]) {
      console.log(`\n[TP1] ${positionSide} @ ${price.toFixed(2)} → SL в безубыток`);
      this.firstTPTaken[positionSide] = true;
      const opposite = positionSide === 'LONG' ? 'SHORT' : 'LONG';
      await OrderManager.moveSLToBreakeven(this.symbol, opposite, this.entryPrice);
    }

    // === ОБЕ ПОЗИЦИИ ЗАКРЫТЫ? → НОВЫЙ ЦИКЛ ===
    if (this.positionsClosed.LONG && this.positionsClosed.SHORT) {
      console.log(`\n[ЦИКЛ ЗАВЕРШЁН] Обе позиции закрыты → новый вход через 1 сек...`);
      this.active = false;
      setTimeout(() => this.restartEntry(), 1000);
    }
  }

  // === ВСПОМОГАТЕЛЬНЫЙ МЕТОД: получить позицию ===
  async getPosition(positionSide) {
    const positions = await OrderManager.signedRequest('GET', '/fapi/v1/positionRisk', { symbol: this.symbol });
    return positions.find(p => p.positionSide === positionSide);
  }

  // === СРАБАТЫВАНИЕ СТОПА ===
  async handlePrice({ symbol, price }) {
    if (!this.active || symbol !== this.symbol) return;

    if (price <= this.longSL) {
      console.log(`\n[STOP] LONG сработал → SL SHORT в безубыток`);
      await OrderManager.moveSLToBreakeven(this.symbol, 'SHORT', this.entryPrice);
      this.positionsClosed.LONG = true;
    }

    if (price >= this.shortSL) {
      console.log(`\n[STOP] SHORT сработал → SL LONG в безубыток`);
      await OrderManager.moveSLToBreakeven(this.symbol, 'LONG', this.entryPrice);
      this.positionsClosed.SHORT = true;
    }

    // Проверяем, не закрыты ли обе
    if (this.positionsClosed.LONG && this.positionsClosed.SHORT) {
      this.active = false;
      setTimeout(() => this.restartEntry(), 1000);
    }
  }

  async stop() {
    this.wsManager.stop();
    this.active = false;
    console.log('Бот остановлен');
  }
}

module.exports = TradingBot;