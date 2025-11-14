// src/strategies/GridDualStrategy.ts

import { IPosition, OrderManager } from "../services/OrderManager";
import { roundToFixed } from "../utils/roundToFixed";

interface Position {
  entry: number;
  stop: number;
  takeProfits: number[];
  side: "LONG" | "SHORT";
  positionSide: "LONG" | "SHORT";
  positionAmt: number;
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
  private notionalPerSide = 20 * 50; // 20 usd per position
  private range = 0.02;
  private gridCount = 10;
  private leverage = 20;

  private onCycleComplete?: () => void;

  constructor(private orderManager: OrderManager) {}

  setOnCycleComplete(callback: () => void) {
    this.onCycleComplete = callback;
  }

  async fillPositions(entryPrice: number) {
    const { long, short } = await this.orderManager.getPosition();

    if (long) {
      const entry = long.entryPrice || entryPrice;
      const stopDistance = entry * this.range;
      const tpStep = stopDistance / this.gridCount;

      this.long = {
        entry,
        stop: roundToFixed(entry - stopDistance, 2),
        takeProfits: Array.from({ length: this.gridCount }, (_, i) => roundToFixed(entry + stopDistance + tpStep * (i + 1), 2)),
        side: "LONG",
        positionSide: "LONG",
        positionAmt: long.positionAmt || 0,
        active: true,
        takeProfitTriggered: false,
        closed: false,
        stopOrderId: undefined,
      };
    }

    if (short) {
      const entry = short.entryPrice || entryPrice;
      const stopDistance = entry * this.range;
      const tpStep = stopDistance / this.gridCount;

      this.short = {
        entry,
        stop: roundToFixed(entry + stopDistance, 2),
        takeProfits: Array.from({ length: this.gridCount }, (_, i) => roundToFixed(entry - stopDistance - tpStep * (i + 1), 2)),
        side: "SHORT",
        positionSide: "SHORT",
        positionAmt: short.positionAmt || 0,
        active: true,
        takeProfitTriggered: false,
        closed: false,
        stopOrderId: undefined,
      };
    }
  }

  async start(entryPrice: number, restart: VoidFunction): Promise<any> {
    await this.fillPositions(entryPrice);

    // Cancel all if no position
    if (!this.long && !this.short) {
      await this.orderManager.cancelAll(this.symbol);
    }

    // Wait if position exists
    if (this.long || this.short) {
      await new Promise(r => setTimeout(r, 60000));
      restart();
      return "Waiting for the end of the cycle!";
    }

    const qtyPerGrid = roundToFixed(this.notionalPerSide / this.gridCount / entryPrice, 6);

    await this.orderManager.ensureHedgeMode();
    await this.orderManager.ensureIsolatedMargin();

    await this.orderManager.setLeverage(this.leverage, "LONG");
    await this.orderManager.setLeverage(this.leverage, "SHORT");

    await this.openPositions(entryPrice);
    await new Promise(res => setTimeout(res, 300));
    await this.placeInitialOrders(qtyPerGrid);

    return "Session started!";
  }

  private async openPositions(entryPrice: number) {
    const qty = roundToFixed(this.notionalPerSide / entryPrice, 6);

    console.log(`Opening LONG: $${this.notionalPerSide} → ${qty} BTC`);
    console.log(`Opening SHORT: $${this.notionalPerSide} → ${qty} BTC`);

    const positions = await Promise.all([
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
    await this.fillPositions(entryPrice);
  }

  private async placeInitialOrders(qtyPerGrid: number) {
    if (!this.long || !this.short) return;

    const orders: (() => Promise<any>)[] = [];

    // УБРАЛИ УМНОЖЕНИЕ НА LEVERAGE
    const tpQty = roundToFixed(qtyPerGrid, 6); // 0.000098 ≈ 0.0001 BTC
    console.log(`TP grid size: ${tpQty} BTC (per grid, no leverage multiplier)`);

    // === STOP ORDERS (полная позиция) ===
    if (this.long) {
      orders.push(async () => {
        const result = await this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "SELL",
          type: "STOP_MARKET",
          quantity: this.long!.positionAmt,
          positionSide: "LONG",
          stopPrice: this.long!.stop,
        });
        this.long!.stopOrderId = result.orderId?.toString();
        console.log(`LONG stop placed: ${this.long!.stop}`);
      });
    }

    if (this.short) {
      orders.push(async () => {
        const result = await this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "BUY",
          type: "STOP_MARKET",
          quantity: Math.abs(this.short!.positionAmt),
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

    /* setTimeout(() => {
      this.handleOrderFilled({
        symbol: "BTCUSDT",
        side: "BUY",
        type: "MARKET",
        price: 104087.8,
        qty: 0.009,
        orderId: 816601452642,
        tradeId: 6853821401,
        commissionAmount: 0.4683951,
        commissionAsset: "USDT",
        realisedProfit: -19.0782,
        positionSide: "SHORT",
        isMakerTrade: false,
        orderTradeTime: 1762872205048,
      });
    }, 5000);
    setTimeout(() => {
      this.handleOrderFilled({
        symbol: "BTCUSDT",
        side: "SELL",
        type: "LIMIT",
        price: 103864.3,
        qty: 0.001,
        orderId: 816601452969,
        tradeId: 6853867458,
        commissionAmount: 0.02077286,
        commissionAsset: "USDT",
        realisedProfit: 2.3443,
        positionSide: "LONG",
        isMakerTrade: true,
        orderTradeTime: 1762872570045,
      });
    }, 10000); */
  }

  async handleOrderFilled(order: any) {
    console.log("ORDER FILLED:", order);
    const isLongFill = order.side === "SELL" && order.positionSide === "LONG";
    const isShortFill = order.side === "BUY" && order.positionSide === "SHORT";

    // === STOP HIT ===
    if (order.type === "MARKET") {
      if (isLongFill && this.long?.active) {
        this.long.closed = true;
        this.long.active = false;
        console.log("❌ LONG stopped out");
        await this.moveOppositeToBreakeven("LONG");
      }
      if (isShortFill && this.short?.active) {
        this.short.closed = true;
        this.short.active = false;
        console.log("❌ SHORT stopped out");
        await this.moveOppositeToBreakeven("SHORT");
      }
    }

    // === FIRST TP HIT → MOVE STOP TO BREAKEVEN ===
    if (order.type === "LIMIT" && !this.long?.takeProfitTriggered && isLongFill) {
      this.long!.takeProfitTriggered = true;
      console.log("✅ LONG first TP hit → moving stop to BE");
      await this.moveStopToBreakeven("LONG");
    }
    if (order.type === "LIMIT" && !this.short?.takeProfitTriggered && isShortFill) {
      this.short!.takeProfitTriggered = true;
      console.log("✅ SHORT first TP hit → moving stop to BE");
      await this.moveStopToBreakeven("SHORT");
    }

    // === CYCLE COMPLETE ===
    if (this.long?.closed && this.short?.closed) {
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
      await this.orderManager.cancelOrder(this.symbol, opposite.stopOrderId!);

      const result = await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: closedSide === "LONG" ? "BUY" : "SELL",
        type: "STOP_MARKET",
        quantity: Math.abs(opposite.positionAmt),
        stopPrice: newStop,
        positionSide: opposite.positionSide,
      });
      opposite.stopOrderId = result.orderId?.toString();
    } catch (error) {
      console.warn(`⚠️ Change stop to BE failed ${opposite.side}`);
    }
  }

  private async moveStopToBreakeven(side: "LONG" | "SHORT") {
    const position = side === "LONG" ? this.long : this.short;
    const opposite = side === "LONG" ? this.short : this.long;
    if (!position || !position.active || !position.stopOrderId || !opposite) return;

    const newStop = opposite.stop;
    console.log(`🔄 Moving ${side} stop to breakeven: ${newStop}`);

    try {
      await this.orderManager.cancelOrder(this.symbol, position.stopOrderId!);

      const result = await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: side === "LONG" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        quantity: Math.abs(position.positionAmt),
        stopPrice: newStop,
        positionSide: side,
      });
      position.stopOrderId = result.orderId?.toString();
    } catch (error) {
      console.warn(`⚠️ Change stop to TP failed, using cancel+place for ${side}`);
    }
  }

  async reset() {
    // await this.orderManager.cancelAll(this.symbol);
    this.long = null;
    this.short = null;
    console.log("🔄 Strategy reset");
  }
}
