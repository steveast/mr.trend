// src/services/UserDataStreamManager.ts

import { WebsocketClient } from "binance";
import { USDMClient } from "binance";
import { EventEmitter } from "events";

export class UserDataStreamManager extends EventEmitter {
  private ws: WebsocketClient | null = null;
  private listenKey: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor(
    private client: USDMClient,
    testnet: boolean = true
  ) {
    super();
    const wsUrl = testnet
      ? "wss://stream.binancefuture.com"
      : "wss://fstream.binance.com";
    this.ws = new WebsocketClient({ wsUrl });
  }

  async start() {
    try {
      const response = await this.client.getFuturesUserDataListenKey();
      this.listenKey = response.listenKey;
      console.log("User Data Stream listenKey:", this.listenKey);

      if (!this.listenKey) throw new Error("No listenKey");

      // КЛЮЧЕВОЕ: as any — обходим баг типизации SDK
      this.ws!.subscribeUsdFuturesUserDataStream(this.listenKey as any);

      this.ws!.on("formattedMessage", (data: any) => {
        if (data.eventType === "ORDER_TRADE_UPDATE") {
          const order = data.order;
          if (
            order.executionType === "TRADE" &&
            order.orderStatus === "FILLED"
          ) {
            this.emit("orderFilled", {
              symbol: order.symbol,
              side: order.side,
              type: order.type,
              price: parseFloat(order.lastFilledPrice || order.price || "0"),
              qty: parseFloat(
                order.lastFilledQuantity || order.quantity || "0"
              ),
              reduceOnly: order.reduceOnly,
            });
          }
        }
      });

      this.keepAliveInterval = setInterval(
        async () => {
          if (this.listenKey) {
            try {
              await this.client.keepAliveFuturesUserDataListenKey();
              console.log("ListenKey renewed");
            } catch (err) {
              console.error("Keep-alive failed:", err);
            }
          }
        },
        25 * 60 * 1000
      );
    } catch (error: any) {
      console.error("UserDataStream start error:", error.message);
    }
  }

  stop() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.listenKey) {
      try {
        this.client.closeFuturesUserDataListenKey();
      } catch (err) {}
      this.listenKey = null;
    }
    if (this.ws) {
      this.ws.closeAll(true);
      this.ws = null;
    }
    console.log("User Data Stream stopped");
  }
}
