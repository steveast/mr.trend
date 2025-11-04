// src/services/WebSocketManager.ts

import { WebsocketClient } from "binance";
import { EventEmitter } from "events";

export class WebSocketManager extends EventEmitter {
  private wsClient: WebsocketClient;

  constructor(testnet: boolean = true) {
    super();
    const wsUrl = testnet ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com";
    this.wsClient = new WebsocketClient({
      wsUrl,
      beautify: testnet,
      api_key: process.env.API_KEY,
      api_secret: process.env.API_SECRET,
      testnet,
    });

    // Подключаемся к событиям
    this.wsClient.on("open", () => console.log("WebSocket connected"));
    this.wsClient.on("reconnecting", () => console.log("WebSocket reconnecting"));
    this.wsClient.on("reconnected", () => console.log("WebSocket reconnected"));

    // ОШИБКИ — только через formattedMessage
    this.wsClient.on("formattedMessage", (data: any) => {
      if (data.eventType === "markPriceUpdate") {
        const markPrice = parseFloat(data.markPrice);
        this.emit("price", markPrice);
      }

      // Ловим ошибки WebSocket
      if (data.code && data.msg) {
        console.error("WebSocket error:", data.msg);
      }
    });

    // НЕ ИСПОЛЬЗУЕМ .on('error') — SDK не позволяет
  }

  start(symbol: string = "BTCUSDT") {
    try {
      // ПРАВИЛЬНЫЙ МЕТОД: usdm + 1000ms
      this.wsClient.subscribeMarkPrice(symbol, "usdm", 1000);
      console.log(`Subscribed to ${symbol}@markPrice@1000ms (USDM)`);
    } catch (err: any) {
      console.error("Subscribe error:", err.message);
    }
  }

  stop() {
    this.wsClient.closeAll(true);
    console.log("WebSocket closed");
  }
}
