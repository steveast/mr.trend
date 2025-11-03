import { OrderManager } from "../services/OrderManager";

interface Position {
  entry: number;
  stop: number;
  takeProfits: number[];
  side: "LONG" | "SHORT";
  active: boolean;
  takeProfitTriggered: boolean;
}

export class GridDualStrategy {
  private long: Position | null = null;
  private short: Position | null = null;
  private symbol = "BTCUSDT";
  private quantity = 0.001; // Настрой под баланс

  constructor(private orderManager: OrderManager) {}

  async start(entryPrice: number) {
    const stopDistance = entryPrice * 0.02;
    const tpStep = stopDistance / 10; // 10 шагов по 10%

    // LONG
    this.long = {
      entry: entryPrice,
      stop: entryPrice - stopDistance,
      takeProfits: Array.from(
        { length: 10 },
        (_, i) => entryPrice + tpStep * (i + 1)
      ),
      side: "LONG",
      active: true,
      takeProfitTriggered: false,
    };

    // SHORT
    this.short = {
      entry: entryPrice,
      stop: entryPrice + stopDistance,
      takeProfits: Array.from(
        { length: 10 },
        (_, i) => entryPrice - tpStep * (i + 1)
      ),
      side: "SHORT",
      active: true,
      takeProfitTriggered: false,
    };

    await this.placeInitialOrders();
  }

  private async placeInitialOrders() {
    if (!this.long || !this.short) return;

    // Стопы
    await this.orderManager.placeOrder({
      symbol: this.symbol,
      side: this.long.side === "LONG" ? "SELL" : "BUY",
      type: "STOP",
      quantity: this.quantity,
      stopPrice: this.long.stop,
    });

    await this.orderManager.placeOrder({
      symbol: this.symbol,
      side: this.short.side === "SHORT" ? "BUY" : "SELL",
      type: "STOP",
      quantity: this.quantity,
      stopPrice: this.short.stop,
    });

    // Тейк-профиты (первые 9 — частичные)
    for (let i = 0; i < 9; i++) {
      const qty = this.quantity / 10;
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: this.long.side === "LONG" ? "SELL" : "BUY",
        type: "TAKE_PROFIT",
        quantity: qty,
        stopPrice: this.long.takeProfits[i],
      });
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: this.short.side === "SHORT" ? "BUY" : "SELL",
        type: "TAKE_PROFIT",
        quantity: qty,
        stopPrice: this.short.takeProfits[i],
      });
    }

    // Последний тейк — закрытие
    await this.orderManager.placeOrder({
      symbol: this.symbol,
      side: this.long.side === "LONG" ? "SELL" : "BUY",
      type: "TAKE_PROFIT",
      quantity: this.quantity * 0.1,
      stopPrice: this.long.takeProfits[9],
    });
    await this.orderManager.placeOrder({
      symbol: this.symbol,
      side: this.short.side === "SHORT" ? "BUY" : "SELL",
      type: "TAKE_PROFIT",
      quantity: this.quantity * 0.1,
      stopPrice: this.short.takeProfits[9],
    });
  }

  async onStopTriggered(side: "LONG" | "SHORT") {
    const position = side === "LONG" ? this.long : this.short;
    const opposite = side === "LONG" ? this.short : this.long;

    if (!position || !opposite) return;

    position.active = false;

    // Выжившая позиция → безубыток
    if (opposite.active) {
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: opposite.side === "LONG" ? "SELL" : "BUY",
        type: "STOP",
        quantity: this.quantity,
        stopPrice: opposite.entry, // безубыток
      });
      console.log(`${opposite.side} moved to breakeven`);
    }
  }

  async onTakeProfitTriggered(side: "LONG" | "SHORT", level: number) {
    const position = side === "LONG" ? this.long : this.short;
    if (!position || position.takeProfitTriggered) return;

    if (level === 0) {
      position.takeProfitTriggered = true;
      // Первый тейк — стоп в безубыток
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: position.side === "LONG" ? "SELL" : "BUY",
        type: "STOP",
        quantity: this.quantity,
        stopPrice: position.entry,
      });
      console.log(`${position.side} first TP → stop to breakeven`);
    }
  }

  async reset() {
    await this.orderManager.cancelAll(this.symbol);
    this.long = null;
    this.short = null;
  }
}
