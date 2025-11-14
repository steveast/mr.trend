import { BinanceClient } from "../services/BinanceClient";
import { OrderManager } from "../services/OrderManager";
import { UserDataStreamManager } from "../services/UserDataStreamManager";
import { GridDualStrategy } from "../strategies/GridDualStrategy";
import { roundToFixed } from "../utils/roundToFixed";

export class MrTrendBot {
  private userStream: UserDataStreamManager;
  private orderManager: OrderManager;
  private strategy: GridDualStrategy;
  private entryTriggered = false;
  private cycleActive = false;
  private readonly symbol = "BTCUSDT";

  constructor(testnet = true) {
    const binance = new BinanceClient(testnet);
    const client = binance.getClient();

    this.orderManager = new OrderManager(client);
    this.strategy = new GridDualStrategy(this.orderManager);

    // Передаём USDMClient и testnet
    this.userStream = new UserDataStreamManager(client, testnet);

    this.strategy.setOnCycleComplete(() => {
      this.cycleActive = false;
      this.entryTriggered = false;
      console.log("Cycle completed. Ready for new entry...");
    });
  }

  async start() {
    console.log("MrTrend Bot Starting...");

    try {
      // === MARK PRICE UPDATE ===
      this.userStream.on("price", (price: number) => {
        if (!this.entryTriggered && !this.cycleActive) {
          const p = roundToFixed(price, 2);
          console.log(`New cycle triggered at mark price: ${p}`);
          this.entryTriggered = true;
          this.cycleActive = true;
          this.strategy
            .start(p, () => {
              this.resetEntryState();
            })
            .then(status => {
              console.log(status);
            })
            .catch(err => {
              console.error("Strategy start failed:", err);
              this.resetEntryState();
            });
        }
      });

      // === ORDER FILLED ===
      this.userStream.on("orderFilled", async (order: any) => {
        if (!this.cycleActive) return;
        try {
          await this.strategy.handleOrderFilled(order);
        } catch (err: any) {
          console.error("Error handling order fill:", err.message);
        }
      });

      // === Запуск стрима (включает mark price + user data) ===
      await this.userStream.start(this.symbol);
      console.log(`Subscribed to ${this.symbol} mark price and user data stream`);
    } catch (error: any) {
      console.error("Failed to start bot:", error.message);
      throw error;
    }
  }

  async stop() {
    console.log("Stopping MrTrend Bot...");
    this.userStream.stop();
    await this.strategy.reset();
    this.resetEntryState();
    console.log("Bot stopped");
  }

  private resetEntryState() {
    this.entryTriggered = false;
    this.cycleActive = false;
  }
}
