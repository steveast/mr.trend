// src/bot/MrTrendBot.ts

import { OrderResult } from "binance";
import { BinanceClient } from "../services/BinanceClient";
import { OrderManager } from "../services/OrderManager";
import { UserDataStreamManager } from "../services/UserDataStreamManager";
import { WebSocketManager } from "../services/WebSocketManager";
import { GridDualStrategy } from "../strategies/GridDualStrategy";
import { roundToFixed } from "../utils/roundToFixed";

export class MrTrendBot {
  private ws: WebSocketManager;
  private userStream: UserDataStreamManager;
  private orderManager: OrderManager;
  private strategy: GridDualStrategy;
  private entryTriggered = false;
  private cycleActive = false;

  constructor(testnet: boolean = true) {
    const binance = new BinanceClient(testnet);
    const client = binance.getClient();
    this.orderManager = new OrderManager(client);
    this.strategy = new GridDualStrategy(this.orderManager);
    this.ws = new WebSocketManager(testnet);
    this.userStream = new UserDataStreamManager(client, testnet);

    // Перезапуск цикла
    this.strategy.setOnCycleComplete(() => {
      this.cycleActive = false;
      this.entryTriggered = false;
      console.log("Ready for new entry...");
    });
  }

  async start() {
    console.log("MrTrend Bot Starting...");

    // Запуск WebSocket цены
    this.ws.on("price", async (priceSource: number) => {
      const price = roundToFixed(priceSource, 2);
      if (!this.entryTriggered && !this.cycleActive) {
        this.entryTriggered = true;
        this.cycleActive = true;
        console.log(`New cycle: Entry at ${price}`);
        await this.strategy.start(price);
      }
    });

    // Запуск User Data Stream
    this.userStream.on("orderFilled", async (order: OrderResult) => {
      if (this.cycleActive) {
        await this.strategy.handleOrderFilled(order);
      }
    });

    this.ws.start("BTCUSDT");
    await this.userStream.start();
  }

  async stop() {
    this.ws.stop();
    this.userStream.stop();
    await this.strategy.reset();
    console.log("Bot stopped");
  }
}
