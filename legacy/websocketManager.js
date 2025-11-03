// websocketManager.js
const WebSocket = require("ws");
const OrderManager = require("./orderManager");
const config = require("./config");

class WebSocketManager {
  constructor() {
    this.priceWs = null;
    this.userDataWs = null;
    this.listeners = {};
    this.reconnectDelay = 5000;
  }

  // ПОДПИСКА НА ЦЕНЫ (BTCUSDT)
  startPriceStream() {
    const url = "wss://fstream.binance.com/ws/btcusdt@markPrice";
    this.priceWs = new WebSocket(url);

    this.priceWs.on("open", () => {
      console.log("WebSocket: цены подключены");
    });

    this.priceWs.on("message", data => {
      try {
        const msg = JSON.parse(data);
        if (msg.e === "markPriceUpdate") {
          const price = parseFloat(msg.p);
          this.emit("priceUpdate", { symbol: "BTCUSDT", price });
        }
      } catch (err) {
        console.error("Ошибка парсинга цены:", err.message);
      }
    });

    this.priceWs.on("close", () => {
      console.log("WebSocket: цены отключены — переподключаемся...");
      setTimeout(() => this.startPriceStream(), this.reconnectDelay);
    });

    this.priceWs.on("error", err => {
      console.error("Ошибка WebSocket цены:", err.message);
    });
  }

  // ПОДПИСКА НА USER DATA (исполнение ордеров)
  async startUserDataStream() {
    try {
      const listenKeyRes = await OrderManager.signedRequest(
        "POST",
        "/fapi/v1/listenKey"
      );
      const listenKey = listenKeyRes.listenKey;
      const url = `wss://fstream.binance.com/ws/${listenKey}`;

      this.userDataWs = new WebSocket(url);

      this.userDataWs.on("open", () => {
        console.log("userData stream: подключено");
      });

      this.userDataWs.on("message", data => {
        try {
          const msg = JSON.parse(data);
          if (msg.e === "ORDER_TRADE_UPDATE") {
            const order = msg.o;
            const status = order.X; // NEW, PARTIALLY_FILLED, FILLED

            if (status === "FILLED") {
              console.log(
                `[FILLED] ${order.ps} ${order.S} @ ${order.L} (qty: ${order.z})`
              );
              this.emit("orderFilled", {
                symbol: order.s,
                side: order.S,
                positionSide: order.ps,
                price: parseFloat(order.L),
                quantity: parseFloat(order.z),
              });
            }
          }
        } catch (err) {
          console.error("Ошибка парсинга userData:", err.message);
        }
      });

      this.userDataWs.on("close", () => {
        console.log("userData stream: отключено — переподключаемся...");
        setTimeout(() => this.startUserDataStream(), this.reconnectDelay);
      });

      this.userDataWs.on("error", err => {
        console.error("Ошибка userData WebSocket:", err.message);
      });

      // Продлеваем listenKey каждые 30 минут
      this.keepAliveInterval = setInterval(
        async () => {
          try {
            await OrderManager.signedRequest("PUT", "/fapi/v1/listenKey");
          } catch (err) {
            console.error("Ошибка продления listenKey:", err.message);
          }
        },
        25 * 60 * 1000
      );
    } catch (err) {
      console.error("Ошибка создания listenKey:", err.message);
      setTimeout(() => this.startUserDataStream(), this.reconnectDelay);
    }
  }

  // ЗАПУСК ВСЕХ ПОТОКОВ
  startMonitoring() {
    this.startPriceStream();
    this.startUserDataStream();
  }

  // ОСТАНОВКА
  stop() {
    if (this.priceWs) this.priceWs.close();
    if (this.userDataWs) this.userDataWs.close();
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    console.log("WebSocket: все потоки остановлены");
  }

  // EVENT EMITTER
  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

module.exports = WebSocketManager;
