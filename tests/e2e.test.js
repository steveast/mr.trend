// tests/e2e.test.js
const TradingBot = require('../bot');
const OrderManager = require('../orderManager');
const WebSocketManager = require('../websocketManager');

jest.setTimeout(120000); // 2 минуты

describe('E2E: Полный цикл хедж-бота', () => {
  let bot;
  let mockPrice = 60000; // стартовая цена

  beforeAll(async () => {
    // Инициализация tickSize
    await OrderManager.initTickSize();

    bot = new TradingBot();

    // Мокаем WebSocket цены
    const originalStartPriceStream = WebSocketManager.prototype.startPriceStream;
    WebSocketManager.prototype.startPriceStream = function () {
      console.log('Мокаем price stream...');
      this.priceWs = { on: jest.fn(), close: jest.fn() };

      // Эмулируем поток цен
      const sendPrice = (price) => {
        this.emit('priceUpdate', { symbol: 'BTCUSDT', price });
      };

      // Через 2 сек — вход
      setTimeout(() => sendPrice(mockPrice), 2000);

      // Через 5 сек — первый TP (LONG)
      setTimeout(() => {
        mockPrice = 60500;
        sendPrice(mockPrice);
      }, 5000);

      // Через 8 сек — первый TP (SHORT)
      setTimeout(() => {
        mockPrice = 59500;
        sendPrice(mockPrice);
      }, 8000);

      // Через 12 сек — срабатывает SL LONG
      setTimeout(() => {
        mockPrice = mockPrice * 0.98 - 100; // ниже SL
        sendPrice(mockPrice);
      }, 12000);

      // В beforeAll, после setTimeout'ов для цены:
      setTimeout(() => {
        // Эмулируем первый TP LONG
        bot.wsManager.emit('orderFilled', {
          symbol: 'BTCUSDT',
          side: 'SELL',
          positionSide: 'LONG',
          price: 60500,
          quantity: 0.0001
        });
      }, 6000);

      setTimeout(() => {
        // Эмулируем первый TP SHORT
        bot.wsManager.emit('orderFilled', {
          symbol: 'BTCUSDT',
          side: 'BUY',
          positionSide: 'SHORT',
          price: 59500,
          quantity: 0.0001
        });
      }, 9000);

      setTimeout(() => {
        // Эмулируем срабатывание SL LONG
        bot.wsManager.emit('orderFilled', {
          symbol: 'BTCUSDT',
          side: 'SELL',
          positionSide: 'LONG',
          price: mockPrice * 0.98,
          quantity: 0.001
        });
      }, 13000);
    };
  });

  afterAll(async () => {
    await bot.stop();
  });

  test('Должен пройти полный цикл: вход → TP → безубыток → SL → новый вход', async () => {
    const logs = [];
    const originalLog = console.log;
    console.log = (msg) => logs.push(msg);

    // Мокаем orderFilled
    const originalEmit = WebSocketManager.prototype.emit;
    const emittedEvents = [];

    WebSocketManager.prototype.emit = function (event, data) {
      emittedEvents.push({ event, data });
      originalEmit.call(this, event, data);
    };

    // Запуск
    await bot.start();

    // Ждём завершения цикла
    await new Promise(resolve => {
      const check = setInterval(() => {
        const hasNewEntry = logs.some(l => l.includes('[НОВЫЙ ЦИКЛ]'));
        const hasBreakeven = logs.some(l => l.includes('SL') && l.includes('безубыток'));
        const hasTP = logs.some(l => l.includes('[TP1]'));
        const hasSL = logs.some(l => l.includes('[STOP]'));

        if (hasNewEntry && hasBreakeven && hasTP && hasSL) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });

    // Восстанавливаем
    console.log = originalLog;
    WebSocketManager.prototype.emit = originalEmit;

    // === ПРОВЕРКИ ===
    expect(logs.some(l => l.includes('[ВХОД] Хедж по цене'))).toBe(true);
    expect(logs.some(l => l.includes('Грид тейков выставлен'))).toBe(true);
    expect(logs.some(l => l.includes('[TP1] LONG'))).toBe(true);
    expect(logs.some(l => l.includes('[TP1] SHORT'))).toBe(true);
    expect(logs.some(l => l.includes('SL SHORT → безубыток'))).toBe(true);
    expect(logs.some(l => l.includes('[STOP] LONG сработал'))).toBe(true);
    expect(logs.some(l => l.includes('[ЦИКЛ ЗАВЕРШЁН]'))).toBe(true);
    expect(logs.some(l => l.includes('[НОВЫЙ ЦИКЛ]'))).toBe(true);

    console.log('E2E тест пройден!');
  });
});