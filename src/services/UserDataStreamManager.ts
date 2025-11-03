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
    const wsURL = testnet
      ? "wss://stream.binancefuture.com"
      : "wss://fstream.binance.com";
    this.ws = new WebsocketClient({ wsURL });
  }

  async start() {
    try {
      this.listenKey = await this.client.startFuturesUserDataStream();
      console.log("User Data Stream started:", this.listenKey);

      this.ws!.subscribeUserDataStream(this.listenKey);

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
              price: parseFloat(order.price),
              qty: parseFloat(order.quantity),
              reduceOnly: order.reduceOnly,
            });
          }
        }
      });

      // Keep-alive каждые 30 минут
      this.keepAliveInterval = setInterval(
        async () => {
          if (this.listenKey) {
            await this.client.keepAliveFuturesUserDataStream();
          }
        },
        25 * 60 * 1000
      );
    } catch (error: any) {
      console.error("UserDataStream error:", error.message);
    }
  }

  stop() {
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.listenKey) this.client.closeFuturesUserDataStream();
    if (this.ws) this.ws.closeAll(true);
    console.log("User Data Stream stopped");
  }
}
