// src/strategies/GridDualStrategy.ts

import { OrderManager } from "../services/OrderManager";

interface Position {
  entry: number;
  stop: number;
  takeProfits: number[];
  side: "LONG" | "SHORT";
  active: boolean;
  takeProfitTriggered: boolean;
  closed: boolean;
}

export class GridDualStrategy {
  private long: Position | null = null;
  private short: Position | null = null;
  private symbol = "BTCUSDT";
  private quantity = 0.001;
  private onCycleComplete?: () => void;

  constructor(private orderManager: OrderManager) {}

  setOnCycleComplete(callback: () => void) {
    this.onCycleComplete = callback;
  }

  async start(entryPrice: number) {
    const stopDistance = entryPrice * 0.02;
    const tpStep = stopDistance / 10;

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
      closed: false,
    };

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
      closed: false,
    };

    await this.placeInitialOrders();
  }

  private async placeInitialOrders() {
    if (!this.long || !this.short) return;

    // === СТОПЫ ===
    await this.orderManager.placeOrder({
      symbol: this.symbol,
      side: "SELL",
      type: "STOP_MARKET",
      quantity: this.quantity,
      stopPrice: this.long.stop,
      reduceOnly: true,
    });

    await this.orderManager.placeOrder({
      symbol: this.symbol,
      side: "BUY",
      type: "STOP_MARKET",
      quantity: this.quantity,
      stopPrice: this.short.stop,
      reduceOnly: true,
    });

    // === ТЕЙК-ПРОФИТЫ (9 частичных + 1 финальный) ===
    /* for (let i = 0; i < 9; i++) {
      const qty = this.quantity / 10;

      // LONG TP
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: "SELL",
        type: "TAKE_PROFIT_MARKET",
        quantity: qty,
        stopPrice: this.long.takeProfits[i],
        reduceOnly: true,
      });

      // SHORT TP
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: "BUY",
        type: "TAKE_PROFIT_MARKET",
        quantity: qty,
        stopPrice: this.short.takeProfits[i],
        reduceOnly: true,
      });
    } */

    // Последний тейк — закрывает позицию
   /*  await this.orderManager.placeOrder({
      symbol: this.symbol,
      side: "SELL",
      type: "TAKE_PROFIT_MARKET",
      quantity: this.quantity * 0.1,
      stopPrice: this.long.takeProfits[9],
      reduceOnly: true,
    }); */

    /* await this.orderManager.placeOrder({
      symbol: this.symbol,
      side: "BUY",
      type: "TAKE_PROFIT_MARKET",
      quantity: this.quantity * 0.1,
      stopPrice: this.short.takeProfits[9],
      reduceOnly: true,
    }); */
  }

  async handleOrderFilled(order: any) {
    if (!this.long || !this.short) return;

    const isLong = order.side === "SELL" && order.reduceOnly;
    const isShort = order.side === "BUY" && order.reduceOnly;

    if (order.type === "STOP_MARKET") {
      if (isLong && this.long.active) {
        this.long.closed = true;
        this.long.active = false;
        console.log("LONG closed by STOP");
        await this.moveOppositeToBreakeven("LONG");
      }
      if (isShort && this.short.active) {
        this.short.closed = true;
        this.short.active = false;
        console.log("SHORT closed by STOP");
        await this.moveOppositeToBreakeven("SHORT");
      }
    }

    if (order.type === "TAKE_PROFIT_MARKET") {
      if (
        isLong &&
        order.price >= this.long.takeProfits[0] &&
        !this.long.takeProfitTriggered
      ) {
        this.long.takeProfitTriggered = true;
        await this.moveStopToBreakeven("LONG");
      }
      if (
        isShort &&
        order.price <= this.short.takeProfits[0] &&
        !this.short.takeProfitTriggered
      ) {
        this.short.takeProfitTriggered = true;
        await this.moveStopToBreakeven("SHORT");
      }
    }

    if (this.long.closed && this.short.closed) {
      console.log("Both positions closed. Restarting cycle...");
      await this.reset();
      this.onCycleComplete?.();
    }
  }

  private async moveOppositeToBreakeven(closedSide: "LONG" | "SHORT") {
    const opposite = closedSide === "LONG" ? this.short : this.long;
    if (opposite && opposite.active) {
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: opposite.side === "LONG" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        quantity: this.quantity,
        stopPrice: opposite.entry,
        reduceOnly: true,
      });
      console.log(`${opposite.side} moved to breakeven`);
    }
  }

  private async moveStopToBreakeven(side: "LONG" | "SHORT") {
    const position = side === "LONG" ? this.long : this.short;
    if (position && position.active) {
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: side === "LONG" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        quantity: this.quantity,
        stopPrice: position.entry,
        reduceOnly: true,
      });
      console.log(`${side} first TP → stop to breakeven`);
    }
  }

  async reset() {
    await this.orderManager.cancelAll(this.symbol);
    this.long = null;
    this.short = null;
    console.log("Strategy reset");
  }
}
