// websocketManager.js — ПОЛНОСТЬЮ РАБОЧИЙ userData
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
    this.listenKey = null;
    this.keepAliveInterval = null;
  }

  async startMonitoring() {
    // 1. aggTrade — цены
    config.symbols.forEach(symbol => {
      const stream = this.client.ws.futuresAggTrades(symbol, trade => {
        const price = parseFloat(trade.price);
        if (isNaN(price)) return;
        this.emit('priceUpdate', { symbol, price, time: Date.now() });
        console.log(`[${symbol}] Цена: ${price.toFixed(2)}`);
      });
      this.subscriptions.set(symbol, stream);
    });

    // 2. userData — ордера
    try {
      this.listenKey = await this.client.futuresUserDataStream();
      console.log('userData stream: подключено');

      const userStream = this.client.ws.futuresUserData(
        this.listenKey,
        update => {
          if (update.eventType === 'ORDER_TRADE_UPDATE') {
            const o = update.order;
            if (o.executionType === 'TRADE' && o.orderStatus === 'FILLED') {
              this.emit('orderFilled', {
                symbol: o.symbol,
                side: o.side,
                positionSide: o.positionSide,
                price: parseFloat(o.lastFilledPrice),
                qty: parseFloat(o.lastFilledQuantity),
                orderId: o.orderId,
              });
            }
          }
        }
      );

      this.subscriptions.set('userData', userStream);

      // Keep-alive каждые 30 минут
      this.keepAliveInterval = setInterval(async () => {
        try {
          await this.client.futuresKeepAliveUserDataStream(this.listenKey);
        } catch (err) {
          console.error('Keep-alive failed:', err.message);
        }
      }, 25 * 60 * 1000); // 25 минут

    } catch (err) {
      console.error('userData stream ошибка:', err.message);
    }

    console.log(`WebSocket: цены + userData`);
  }

  stop() {
    this.subscriptions.forEach(unsub => {
      try { unsub(); } catch (e) {}
    });
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.listenKey) {
      this.client.futuresCloseUserDataStream(this.listenKey).catch(() => {});
    }
    this.subscriptions.clear();
    console.log('WebSocket отключён');
  }
}

module.exports = WebSocketManager;