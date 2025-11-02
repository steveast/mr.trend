// websocketManager.js
const { EventEmitter } = require('events');
const config = require('./config');
const WebSocket = require('ws');
if (!global.fetch) {
  global.fetch = require('node-fetch');
}

class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.subscriptions = new Map();
    this.listenKey = null;
    this.wsPrice = null;
    this.wsUser = null;
  }

  async startMonitoring() {
    const symbol = config.symbols[0].toLowerCase();

    // ЦЕНЫ — aggTrade (ОДИН URL ДЛЯ ТЕСТНЕТА И МЕЙНА)
    const priceUrl = `wss://stream.binancefuture.com/ws/${symbol}@aggTrade`;
    this.wsPrice = new WebSocket(priceUrl);

    this.wsPrice.on('open', () => {
      console.log('WebSocket: цены подключены');
    });

    this.wsPrice.on('message', data => {
      const trade = JSON.parse(data);
      const price = parseFloat(trade.p);
      if (isNaN(price)) return;
      this.emit('priceUpdate', { symbol: config.symbols[0], price });
    });

    this.wsPrice.on('error', err => console.error('WebSocket цены ошибка:', err.message));
    this.wsPrice.on('close', () => console.log('WebSocket цены отключён'));

    // USER DATA — listenKey
    try {
      const baseUrl = config.testnet 
        ? 'https://testnet.binancefuture.com' 
        : 'https://fapi.binance.com';

      const listenKeyUrl = `${baseUrl}/fapi/v1/listenKey`;
      const res = await fetch(listenKeyUrl, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': config.apiKey },
      });
      const { listenKey } = await res.json();
      this.listenKey = listenKey;

      // userData — ТОТ ЖЕ URL: stream.binancefuture.com
      const userUrl = `wss://stream.binancefuture.com/ws/${listenKey}`;
      this.wsUser = new WebSocket(userUrl);

      this.wsUser.on('open', () => console.log('userData stream: подключено'));
      this.wsUser.on('message', data => {
        const update = JSON.parse(data);
        if (update.e === 'ORDER_TRADE_UPDATE') {
          const o = update.o;
          if (o.X === 'FILLED' && o.x === 'TRADE') {
            this.emit('orderFilled', {
              symbol: o.s,
              side: o.S,
              positionSide: o.ps,
              price: parseFloat(o.L),
              qty: parseFloat(o.l),
            });
          }
        }
      });

      this.wsUser.on('error', err => console.error('userData ошибка:', err.message));

      // Keep-alive
      this.keepAliveInterval = setInterval(async () => {
        try {
          await fetch(listenKeyUrl, { method: 'PUT', headers: { 'X-MBX-APIKEY': config.apiKey } });
        } catch (e) {}
      }, 25 * 60 * 1000);

    } catch (err) {
      console.error('userData stream ошибка:', err.message);
    }

    console.log('WebSocket: цены + userData (без логов цен)');
  }

  stop() {
    [this.wsPrice, this.wsUser].forEach(ws => ws?.close());
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.listenKey) {
      const baseUrl = config.testnet 
        ? 'https://testnet.binancefuture.com' 
        : 'https://fapi.binance.com';
      fetch(`${baseUrl}/fapi/v1/listenKey`, {
        method: 'DELETE',
        headers: { 'X-MBX-APIKEY': config.apiKey },
      }).catch(() => {});
    }
    console.log('WebSocket отключён');
  }
}

module.exports = WebSocketManager;