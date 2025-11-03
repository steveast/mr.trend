// src/services/WebSocketManager.ts

import { WebsocketClient } from "binance";
import { EventEmitter } from "events";

export class WebSocketManager extends EventEmitter {
  private wsClient: WebsocketClient;

  constructor(testnet: boolean = true) {
    super();
    const wsURL = testnet
      ? "wss://stream.binancefuture.com"
      : "wss://fstream.binance.com";
    this.wsClient = new WebsocketClient({ wsURL });

    this.wsClient.on("formattedMessage", (data: any) => {
      if (data.eventType === "markPriceUpdate") {
        const markPrice = parseFloat(data.markPrice);
        this.emit("price", markPrice);
      }
    });

    this.wsClient.on("open", () => console.log("WebSocket connected"));
    this.wsClient.on("reconnecting", () =>
      console.log("WebSocket reconnecting")
    );
    this.wsClient.on("reconnected", () => console.log("WebSocket reconnected"));
    this.wsClient.on("error", err => console.error("WebSocket error:", err));
  }

  start(symbol: string = "BTCUSDT") {
    this.wsClient.subscribeUsdFuturesMarkPrice(symbol.toLowerCase(), "1s");
    console.log(`Subscribed to ${symbol}@markPrice@1s`);
  }

  stop() {
    this.wsClient.closeAll(true);
    console.log("WebSocket closed");
  }
}
