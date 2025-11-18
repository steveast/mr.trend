import { BinanceClient } from '../services/BinanceClient';
import { OrderManager } from '../services/OrderManager';
import { TelegramNotifier } from '../services/TelegramNotifier';
import { UserDataStreamManager } from '../services/UserDataStreamManager';
import { GridDualStrategy } from '../strategies/GridDualStrategy';
import { roundToFixed } from '../utils/roundToFixed';

export class MrTrendBot {
  private userStream: UserDataStreamManager;
  private orderManager: OrderManager;
  private strategy: GridDualStrategy;
  private notifier: TelegramNotifier;
  private entryTriggered = false;
  private cycleActive = false;
  private needRestart = false;
  private testnet = false;
  private readonly symbol = 'BTCUSDT';
  private PnL: number = 0;

  constructor(testnet = true) {
    const binance = new BinanceClient(testnet);
    const client = binance.getClient();
    this.testnet = testnet;

    this.orderManager = new OrderManager(client);
    this.strategy = new GridDualStrategy(this.orderManager);
    this.notifier = new TelegramNotifier();

    // Передаём USDMClient и testnet
    this.userStream = new UserDataStreamManager(client, testnet);

    this.strategy.setOnCycleComplete(() => {
      this.cycleActive = false;
      this.entryTriggered = false;
      this.notifier.cycleCompleted(this.PnL);
      this.PnL = 0;
    });
  }

  async start() {
    this.notifier.botStarted(this.testnet);

    try {
      // === MARK PRICE UPDATE ===
      this.userStream.on('price', (price: number) => {
        if ((!this.entryTriggered && !this.cycleActive) || this.needRestart) {
          const p = roundToFixed(price, 2);
          this.entryTriggered = true;
          this.cycleActive = true;
          this.needRestart = false;
          this.strategy
            .start(p, () => {
              this.needRestart = true;
            })
            .then(status => {
              console.log(status);
            })
            .catch(err => {
              console.error('Strategy start failed:', err);
              this.notifier.error(`Strategy start failed: ${err.message}`);
              this.resetEntryState();
            });
        }
      });

      // === ORDER FILLED ===
      this.userStream.on('orderFilled', async (order: any) => {
        if (!this.cycleActive || order.symbol !== 'BTCUSDT') return;
        try {
          await this.strategy.handleOrderFilled(order);
          this.notifier.orderFilled(order);
          if (order.type === 'LIMIT') {
            this.PnL += parseFloat(order.realisedProfit);
          }
        } catch (err: any) {
          console.error('Error handling order fill:', err.message);
          this.notifier.error(`Order fill error: ${err.message}`);
        }
      });

      // === Запуск стрима (включает mark price + user data) ===
      await this.userStream.start(this.symbol);
      console.log(`Subscribed to ${this.symbol} mark price and user data stream`);
    } catch (error: any) {
      console.error('Failed to start bot:', error.message);
      this.notifier.error(`Bot start failed: ${error.message}`);
      throw error;
    }
  }

  async stop() {
    console.log('Stopping MrTrend Bot...');
    this.userStream.stop();
    await this.strategy.reset();
    this.resetEntryState();
    console.log('Bot stopped');
  }

  private resetEntryState() {
    this.entryTriggered = false;
    this.cycleActive = false;
  }
}
