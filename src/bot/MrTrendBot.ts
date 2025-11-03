import { WebSocketManager } from "../services/WebSocketManager";
import { BinanceClient } from "../services/BinanceClient";
import { OrderManager } from "../services/OrderManager";
import { GridDualStrategy } from "../strategies/GridDualStrategy";

export class MrTrendBot {
  private ws: WebSocketManager;
  private orderManager: OrderManager;
  private strategy: GridDualStrategy;
  private currentPrice: number = 0;
  private entryTriggered: boolean = false;

  constructor() {
    const binance = new BinanceClient(true);
    this.orderManager = new OrderManager(binance.getClient());
    this.strategy = new GridDualStrategy(this.orderManager);
    this.ws = new WebSocketManager();
  }

  async start() {
    console.log("MrTrend Bot Starting...");

    this.ws.on("price", async (price: number) => {
      this.currentPrice = price;

      // Вход по первому касанию (пример: при пересечении 110400)
      if (!this.entryTriggered && price <= 110400) {
        this.entryTriggered = true;
        console.log(`Entry triggered at ${price}`);
        await this.strategy.start(price);
      }

      // Мониторинг стопов и тейков (в реальном времени — через Binance API)
      // Здесь упрощённо — в проде: слушать user data stream
    });

    this.ws.start("BTCUSDT");
  }

  stop() {
    this.ws.stop();
  }
}
