// src/strategies/GridDualStrategy.ts

import { IPosition, OrderManager } from "../services/OrderManager";
import { OrderResult } from "binance";
import { roundToFixed } from "../utils/roundToFixed";

interface Position {
  entry: number;
  stop: number;
  takeProfits: number[];
  side: "LONG" | "SHORT";
  positionSide: "LONG" | "SHORT";
  active: boolean;
  takeProfitTriggered: boolean;
  closed: boolean;
  stopOrderId?: string;
}

export class GridDualStrategy {
  private long: Position | null = null;
  private short: Position | null = null;
  private symbol = "BTCUSDT";

  // === CONFIG: NOTIONAL IN USDT ===
  private notionalPerSide = 1000; // $1000 per side → $2000 total
  private gridCount = 10;
  private leverage = 20;

  private onCycleComplete?: () => void;
  private pos: IPosition = {
    long: undefined,
    short: undefined,
    longAmt: 0,
    shortAmt: 0,
  };

  constructor(private orderManager: OrderManager) {}

  setOnCycleComplete(callback: () => void) {
    this.onCycleComplete = callback;
  }

  async start(entryPrice: number): Promise<any> {
    Object.assign(this.pos, await this.orderManager.getPosition());

    // Cancel all if no position
    if (!this.pos.long && !this.pos.short) {
      await this.orderManager.cancelAll(this.symbol);
    }

    // Wait if position exists
    if (this.pos.long || this.pos.short) {
      console.log("Position exists, waiting 1 minute...");
      await new Promise(r => setTimeout(r, 60000));
      return this.start(entryPrice);
    }

    await this.orderManager.ensureHedgeMode();
    await this.orderManager.ensureIsolatedMargin();

    await this.orderManager.setLeverage(this.leverage, "LONG");
    await this.orderManager.setLeverage(this.leverage, "SHORT");

    const stopDistance = entryPrice * 0.02;
    const tpStep = stopDistance / this.gridCount;
    const qtyPerGrid = roundToFixed(this.notionalPerSide / this.gridCount / entryPrice, 6);

    this.long = {
      entry: entryPrice,
      stop: roundToFixed(entryPrice - stopDistance, 2),
      takeProfits: Array.from({ length: this.gridCount }, (_, i) => roundToFixed(entryPrice + stopDistance + tpStep * (i + 1), 2)),
      side: "LONG",
      positionSide: "LONG",
      active: true,
      takeProfitTriggered: false,
      closed: false,
      stopOrderId: undefined,
    };

    this.short = {
      entry: entryPrice,
      stop: roundToFixed(entryPrice + stopDistance, 2),
      takeProfits: Array.from({ length: this.gridCount }, (_, i) => roundToFixed(entryPrice - stopDistance - tpStep * (i + 1), 2)),
      side: "SHORT",
      positionSide: "SHORT",
      active: true,
      takeProfitTriggered: false,
      closed: false,
      stopOrderId: undefined,
    };

    console.log("LONG Config:", this.long);
    console.log("SHORT Config:", this.short);
    console.log(`Notional per side: $${this.notionalPerSide} → Qty per grid: ${qtyPerGrid} BTC`);

    await this.openPositions(entryPrice);
    Object.assign(this.pos, await this.orderManager.getPosition());

    await new Promise(res => setTimeout(res, 300));
    await this.placeInitialOrders(qtyPerGrid);

    return "Session started!";
  }

  private async openPositions(entryPrice: number) {
    const qty = roundToFixed(this.notionalPerSide / entryPrice, 6);

    console.log(`Opening LONG: $${this.notionalPerSide} → ${qty} BTC`);
    console.log(`Opening SHORT: $${this.notionalPerSide} → ${qty} BTC`);

    await Promise.all([
      this.orderManager.placeOrder({
        symbol: this.symbol,
        side: "BUY",
        positionSide: "LONG",
        type: "MARKET",
        quantity: qty,
      }),
      this.orderManager.placeOrder({
        symbol: this.symbol,
        side: "SELL",
        positionSide: "SHORT",
        type: "MARKET",
        quantity: qty,
      }),
    ]);
  }

  private async placeInitialOrders(qtyPerGrid: number) {
    if (!this.long || !this.short) return;

    const orders: (() => Promise<any>)[] = [];

    // УБРАЛИ УМНОЖЕНИЕ НА LEVERAGE
    const tpQty = roundToFixed(qtyPerGrid, 6); // 0.000098 ≈ 0.0001 BTC
    console.log(`TP grid size: ${tpQty} BTC (per grid, no leverage multiplier)`);

    // === STOP ORDERS (полная позиция) ===
    if (this.pos.long && this.pos.longAmt > 0) {
      orders.push(async () => {
        const result = await this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "SELL",
          type: "STOP_MARKET",
          quantity: this.pos.longAmt,
          positionSide: "LONG",
          stopPrice: this.long!.stop,
        });
        this.long!.stopOrderId = result.orderId?.toString();
        console.log(`LONG stop placed: ${this.long!.stop}`);
      });
    }

    if (this.pos.short && this.pos.shortAmt < 0) {
      orders.push(async () => {
        const result = await this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "BUY",
          type: "STOP_MARKET",
          quantity: Math.abs(this.pos.shortAmt),
          positionSide: "SHORT",
          stopPrice: this.short!.stop,
        });
        this.short!.stopOrderId = result.orderId?.toString();
        console.log(`SHORT stop placed: ${this.short!.stop}`);
      });
    }

    // === TAKE PROFIT GRID ===
    for (let i = 0; i < this.gridCount; i++) {
      const isLast = i === this.gridCount - 1;

      // LONG TP
      orders.push(() =>
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "SELL",
          type: isLast ? "TAKE_PROFIT_MARKET" : "LIMIT",
          quantity: tpQty,
          price: isLast ? undefined : this.long!.takeProfits[i],
          stopPrice: isLast ? this.long!.takeProfits[i] : undefined,
          positionSide: "LONG",
          timeInForce: isLast ? undefined : "GTC",
        })
      );

      // SHORT TP
      orders.push(() =>
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "BUY",
          type: isLast ? "TAKE_PROFIT_MARKET" : "LIMIT",
          quantity: tpQty,
          price: isLast ? undefined : this.short!.takeProfits[i],
          stopPrice: isLast ? this.short!.takeProfits[i] : undefined,
          positionSide: "SHORT",
          timeInForce: isLast ? undefined : "GTC",
        })
      );
    }

    await Promise.all(orders.map(fn => fn()));
    console.log(`All ${this.gridCount * 2} TP orders + 2 stops placed`);
  }

  async handleOrderFilled(order: any) {
    console.log("ORDER FILLED:", order);
    if (!this.long || !this.short) return;

    const isLongFill = order.side === "SELL" && order.positionSide === "LONG";
    const isShortFill = order.side === "BUY" && order.positionSide === "SHORT";

    // === STOP HIT ===
    if (order.type === "STOP_MARKET") {
      if (isLongFill && this.long.active) {
        this.long.closed = true;
        this.long.active = false;
        console.log("❌ LONG stopped out");
        await this.moveOppositeToBreakeven("LONG");
      }
      if (isShortFill && this.short.active) {
        this.short.closed = true;
        this.short.active = false;
        console.log("❌ SHORT stopped out");
        await this.moveOppositeToBreakeven("SHORT");
      }
    }

    // === FIRST TP HIT → MOVE STOP TO BREAKEVEN ===
    if (order.type === "LIMIT" && !this.long.takeProfitTriggered && isLongFill) {
      this.long.takeProfitTriggered = true;
      console.log("✅ LONG first TP hit → moving stop to BE");
      await this.moveStopToBreakeven("LONG");
    }
    if (order.type === "LIMIT" && !this.short.takeProfitTriggered && isShortFill) {
      this.short.takeProfitTriggered = true;
      console.log("✅ SHORT first TP hit → moving stop to BE");
      await this.moveStopToBreakeven("SHORT");
    }

    // === CYCLE COMPLETE ===
    if (this.long.closed && this.short.closed) {
      console.log("🎉 Both sides closed. Cycle complete.");
      await this.reset();
      this.onCycleComplete?.();
    }
  }

  private async moveOppositeToBreakeven(closedSide: "LONG" | "SHORT") {
    const opposite = closedSide === "LONG" ? this.short : this.long;
    if (!opposite || !opposite.active || !opposite.stopOrderId) return;

    const newStop = opposite.entry;
    console.log(`🔄 Moving ${opposite.side} stop to breakeven: ${newStop}`);

    try {
      await this.orderManager.modifyOrder(opposite.stopOrderId, { stopPrice: newStop });
      console.log(`✅ ${opposite.side} stop moved to BE (modify)`);
    } catch (error) {
      console.warn(`⚠️ Modify failed, using cancel+place for ${opposite.side}`);
      await this.orderManager.cancelOrder(this.symbol, opposite.stopOrderId!);

      const result = await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: closedSide === "LONG" ? "BUY" : "SELL",
        type: "STOP_MARKET",
        quantity: Math.abs(this.pos.shortAmt || this.pos.longAmt),
        stopPrice: newStop,
        positionSide: opposite.positionSide,
      });
      opposite.stopOrderId = result.orderId?.toString();
    }
  }

  private async moveStopToBreakeven(side: "LONG" | "SHORT") {
    const position = side === "LONG" ? this.long : this.short;
    if (!position || !position.active || !position.stopOrderId) return;

    const newStop = position.entry;
    console.log(`🔄 Moving ${side} stop to breakeven: ${newStop}`);

    try {
      await this.orderManager.modifyOrder(position.stopOrderId, { stopPrice: newStop });
      console.log(`✅ ${side} stop moved to BE (modify)`);
    } catch (error) {
      console.warn(`⚠️ Modify failed, using cancel+place for ${side}`);
      await this.orderManager.cancelOrder(this.symbol, position.stopOrderId!);

      const result = await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: side === "LONG" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        quantity: Math.abs(this.pos.longAmt || this.pos.shortAmt),
        stopPrice: newStop,
        positionSide: side,
      });
      position.stopOrderId = result.orderId?.toString();
    }
  }

  async reset() {
    await this.orderManager.cancelAll(this.symbol);
    this.long = null;
    this.short = null;
    Object.assign(this.pos, { long: undefined, short: undefined, longAmt: 0, shortAmt: 0 });
    console.log("🔄 Strategy reset");
  }
}
