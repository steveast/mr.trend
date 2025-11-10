import { USDMClient, WebsocketClient } from "binance";
import { EventEmitter } from "events";

/**
 * Объединённый менеджер:
 *  - Подписка на mark price (USDM, 1000ms)
 *  - User Data Stream (listenKey, keep-alive, order updates)
 */
export class UserDataStreamManager extends EventEmitter {
  private ws: WebsocketClient;
  private client: USDMClient;
  private listenKey: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;
  private testnet: boolean;

  constructor(client: USDMClient, testnet: boolean = true) {
    super();
    this.client = client;
    this.testnet = testnet;

    // Один WebSocket клиент для всех потоков
    this.ws = new WebsocketClient({
      // wsUrl: testnet ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com",
      beautify: true,
      api_key: process.env.API_KEY,
      api_secret: process.env.API_SECRET,
      testnet,
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers() {
    // Подключение
    this.ws.on("open", () => console.log("WebSocket connected"));
    this.ws.on("reconnecting", () => console.log("WebSocket reconnecting"));
    this.ws.on("reconnected", () => console.log("WebSocket reconnected"));

    // Обработка всех сообщений
    this.ws.on("formattedMessage", (data: any) => {
      // console.log(data);
      // === MARK PRICE UPDATE ===
      if (data.eventType === "markPriceUpdate") {
        const markPrice = parseFloat(data.markPrice);
        this.emit("price", markPrice);
        return;
      }

      // === ORDER TRADE UPDATE (User Data Stream) ===
      if (data.eventType === "ORDER_TRADE_UPDATE") {
        const order = data.order;
        if (order.executionType === "TRADE" && order.orderStatus === "FILLED") {
          this.emit("orderFilled", {
            symbol: order.symbol,
            side: order.orderSide,
            type: order.orderType,
            price: parseFloat(order.lastFilledPrice || "0"),
            qty: parseFloat(order.lastFilledQuantity || "0"),
            orderId: order.orderId,
            tradeId: order.tradeId,
            commissionAmount: order.commissionAmount,
            commissionAsset: order.commissionAsset,
            realisedProfit: order.realisedProfit,
            positionSide: order.positionSide,
            // isReduceOnly: order.isReduceOnly,
            isMakerTrade: order.isMakerTrade,
            orderTradeTime: order.orderTradeTime,
          });
        }
        return;
      }

      // === ОШИБКИ ===
      if (data.code && data.msg) {
        console.error("WebSocket error:", data.msg);
      }
    });
  }

  /**
   * Запуск: подписка на mark price + user data stream
   */
  async start(symbol: string = "BTCUSDT") {
    try {
      // 1. Подписка на mark price
      this.ws.subscribeMarkPrice(symbol, "usdm", 1000);
      console.log(`Subscribed to ${symbol}@markPrice@1000ms (USDM)`);

      // 2. User Data Stream
      this.ws.subscribeUsdFuturesUserDataStream();
      console.log("Subscribed to User Data Stream");

      // 3. Keep-alive для listenKey
      this.keepAliveInterval = setInterval(
        async () => {
          if (this.listenKey) {
            try {
              await this.client.keepAliveFuturesUserDataListenKey();
              console.log("ListenKey renewed");
            } catch (err: any) {
              console.error("Keep-alive failed:", err.message);
            }
          }
        },
        25 * 60 * 1000
      ); // каждые 25 минут
    } catch (error: any) {
      console.error("Start error:", error.message);
    }
  }

  /**
   * Остановка всех подписок и таймеров
   */
  stop() {
    // Очистка keep-alive
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }

    // Закрытие listenKey
    if (this.listenKey) {
      try {
        this.client.closeFuturesUserDataListenKey();
        console.log("ListenKey closed");
      } catch (err: any) {
        console.warn("Failed to close listenKey:", err.message);
      }
      this.listenKey = null;
    }

    // Закрытие WebSocket
    if (this.ws) {
      this.ws.closeAll(true);
      console.log("WebSocket closed");
    }
  }
}
