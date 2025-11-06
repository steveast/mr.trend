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
}

export class GridDualStrategy {
  private long: Position | null = null;
  private short: Position | null = null;
  private symbol = "BTCUSDT";
  private quantity = 0.01;
  private onCycleComplete?: () => void;

  // position
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

    if (!this.pos.long && ! this.pos.short) {
      await this.orderManager.cancelAll(this.symbol);
    }

    if (this.pos.long || this.pos.short) {
      console.log("Позиция уже существует, ожидание 1 минута...");
      await new Promise(r => setTimeout(r, 60000));
      return this.start(entryPrice);
    }

    await this.orderManager.ensureHedgeMode();

    const stopDistance = entryPrice * 0.002;
    const tpStep = stopDistance / 10; 

    this.long = {
      entry: entryPrice,
      stop: roundToFixed(entryPrice - stopDistance, 2),
      takeProfits: Array.from({ length: 10 }, (_, i) => roundToFixed(entryPrice + stopDistance + tpStep * (i + 1), 2)),
      side: "LONG",
      positionSide: "LONG",
      active: true,
      takeProfitTriggered: false,
      closed: false,
    };

    this.short = {
      entry: entryPrice,
      stop: entryPrice + stopDistance,
      takeProfits: Array.from({ length: 10 }, (_, i) => roundToFixed(entryPrice - stopDistance - tpStep * (i + 1), 2)),
      side: "SHORT",
      positionSide: "SHORT",
      active: true,
      takeProfitTriggered: false,
      closed: false,
    };

    console.log("LONG", this.long);
    console.log("SHORT", this.short);

    // ШАГ 1: ОТКРЫВАЕМ ПОЗИЦИИ
    await this.openPositions();
    Object.assign(this.pos, await this.orderManager.getPosition());

    await new Promise(res => setTimeout(res, 200));

    // ШАГ 2: СТАВИМ СТОПЫ И ТЕЙКИ
    await this.placeInitialOrders();
    return "Сессия завершена!";
  }

  private async openPositions() {
    if (!this.long || !this.short) return;

    console.log(`Opening LONG at market (${this.quantity} BTC)`);
    console.log(`Opening SHORT at market (${this.quantity} BTC)`);
    const orders = [
      () => (
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "BUY",
          positionSide: "LONG",
          type: "MARKET",
          quantity: this.quantity,
        })
      ),
      () => (
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "SELL",
          positionSide: "SHORT",
          type: "MARKET",
          quantity: this.quantity,
        })
      )
    ];
    await Promise.all(orders.map((x) => x()));
  }

  private async placeInitialOrders() {
    if (!this.long || !this.short) return;

    // собираем ордера в массив
    const qty = this.quantity / 10;
    const orders: (() => Promise<any>)[] = [];

    if (this.pos.long && this.pos.longAmt > 0) {
      orders.push(() =>
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "SELL",
          type: "STOP_MARKET",
          quantity: this.pos.longAmt,
          positionSide: "LONG",
          stopPrice: this.long!.stop,
        })
      );
    }

    if (this.pos.short && this.pos.shortAmt < 0) {
      orders.push(() =>
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "BUY",
          type: "STOP_MARKET",
          quantity: Math.abs(this.pos.shortAmt),
          positionSide: "SHORT",
          stopPrice: this.short!.stop,
        })
      );
    }

    for (let i = 0; i < 10; i++) {
      // LONG TP
      orders.push(() =>
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "SELL",
          type: "LIMIT",
          // type: i === 9 ? "TAKE_PROFIT_MARKET" : "LIMIT",
          quantity: qty,
          price: this.long!.takeProfits[i],
          //stopPrice: i === 9 ? this.long!.takeProfits[i] : undefined,
          positionSide: "LONG",
          timeInForce: "GTC",
          //closePosition: String(i === 9) as any,
        })
      );

      // SHORT TP
      orders.push(() =>
        this.orderManager.placeOrder({
          symbol: this.symbol, 
          side: "BUY",
          type: "LIMIT", 
          // type: i === 9 ? "TAKE_PROFIT_MARKET" : "LIMIT",
          quantity: qty,
          price: this.short!.takeProfits[i],
          //stopPrice: i === 9 ? this.short!.takeProfits[i] : undefined,
          positionSide: "SHORT", 
          timeInForce: "GTC",
          //closePosition: String(i === 9) as any,
        })
      );
    }

    await Promise.all(orders.map(fn => fn()));
    console.log("Все тейки выставлены!");
  }

  async handleOrderFilled(order: OrderResult) {
    console.log('ORDER FILLED', order);
    if (!this.long || !this.short) return;

    const isPos = Boolean(this.pos.long && this.pos.short);
    const isLong = order.side === "SELL";
    const isShort = order.side === "BUY";

    if (order.type === "MARKET" && isPos) {
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

    if (order.type === "LIMIT" && isPos) {
      if (isLong && !this.long.takeProfitTriggered) {
        this.long.takeProfitTriggered = true;
        await this.moveStopToBreakeven("LONG");
      }
      if (isShort && !this.short.takeProfitTriggered) {
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
    console.log('moveOppositeToBreakeven');
    if (opposite && opposite.active) {
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: opposite.side === "LONG" ? "SELL" : "BUY", 
        type: "STOP_MARKET",
        quantity: this.quantity,
        stopPrice: opposite.entry,
        positionSide: closedSide,
      });
      console.log(`${opposite.side} moved to breakeven`);
    }
  }

  private async moveStopToBreakeven(side: "LONG" | "SHORT") {
    const position = side === "LONG" ? this.long : this.short;
    const opposite = side === "LONG" ? this.short : this.long;
    console.log('moveStopToBreakeven');
    if (position && position.active && opposite) {
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: side === "LONG" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        quantity: this.quantity,
        stopPrice: opposite.stop,
        positionSide: side,
      });
      console.log(`${side} first TP → stop to breakeven`);
    }
  }

  async reset() {
    // await this.orderManager.cancelAll(this.symbol);
    this.long = null;
    this.short = null;
    console.log("Strategy reset");
  }
}
