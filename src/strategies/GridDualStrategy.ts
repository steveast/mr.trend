import { IPosition, OrderManager } from "../services/OrderManager";
import { OrderResult } from "binance";

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

    if (this.pos.long || this.pos.short) {
      console.log("Позиция уже существует, ожидание 1 минута...");
      await new Promise(r => setTimeout(r, 60000));
      return this.start(entryPrice);
    }

    await this.orderManager.ensureHedgeMode();

    const stopDistance = entryPrice * 0.02;
    const tpStep = stopDistance / 10;

    this.long = {
      entry: entryPrice,
      stop: +(entryPrice - stopDistance).toFixed(2),
      takeProfits: Array.from({ length: 10 }, (_, i) => +(entryPrice + stopDistance + tpStep * (i + 1)).toFixed(2)),
      side: "LONG",
      positionSide: "LONG",
      active: true,
      takeProfitTriggered: false,
      closed: false,
    };

    this.short = {
      entry: entryPrice,
      stop: entryPrice + stopDistance,
      takeProfits: Array.from({ length: 10 }, (_, i) => +(entryPrice - stopDistance - tpStep * (i + 1)).toFixed(2)),
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

    // Отправляем оба ордера одновременно
    await Promise.all([
      this.orderManager.placeOrder({
        symbol: this.symbol,
        side: "BUY",
        positionSide: "LONG",
        type: "MARKET",
        quantity: this.quantity,
      }),
      this.orderManager.placeOrder({
        symbol: this.symbol,
        side: "SELL",
        positionSide: "SHORT",
        type: "MARKET",
        quantity: this.quantity,
      }),
    ]);

    console.log("Both positions opened at market");
  }

  private async placeInitialOrders() {
    if (!this.long || !this.short) return;

    // собираем ордера в массив
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

    // === 9 частичных тейков ===
    for (let i = 0; i < 9; i++) {
      const qty = this.quantity / 10;
      // LONG TP
      orders.push(() =>
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "SELL",
          type: "TAKE_PROFIT_MARKET",
          quantity: qty,
          stopPrice: this.long!.takeProfits[i],
          positionSide: "LONG",
        })
      );

      // SHORT TP
      orders.push(() =>
        this.orderManager.placeOrder({
          symbol: this.symbol,
          side: "BUY",
          type: "TAKE_PROFIT_MARKET",
          quantity: qty,
          stopPrice: this.short!.takeProfits[i],
          positionSide: "SHORT",
        })
      );
    }

    // === Последний тейк (финальный) ===
    orders.push(() =>
      this.orderManager.placeOrder({
        symbol: this.symbol,
        side: "SELL",
        type: "TAKE_PROFIT_MARKET",
        quantity: this.quantity,
        stopPrice: this.long!.takeProfits[9],
        positionSide: "LONG",
      })
    );

    orders.push(() =>
      this.orderManager.placeOrder({
        symbol: this.symbol,
        side: "BUY",
        type: "TAKE_PROFIT_MARKET",
        quantity: this.quantity,
        stopPrice: this.short!.takeProfits[9],
        positionSide: "SHORT",
      })
    );

    await Promise.all(orders.map(fn => fn()));
    console.log("Все тейки выставлены!");
  }

  async handleOrderFilled(order: OrderResult) {
    if (!this.long || !this.short) return;
    console.log("Order filled", order);

    const isLong = order.side === "SELL";
    const isShort = order.side === "BUY";

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
      if (isLong && Number(order.price) >= this.long.takeProfits[0] && !this.long.takeProfitTriggered) {
        this.long.takeProfitTriggered = true;
        await this.moveStopToBreakeven("LONG");
      }
      if (isShort && Number(order.price) <= this.short.takeProfits[0] && !this.short.takeProfitTriggered) {
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
      });
      console.log(`${opposite.side} moved to breakeven`);
    }
  }

  private async moveStopToBreakeven(side: "LONG" | "SHORT") {
    const position = side === "LONG" ? this.long : this.short;
    const opposite = side === "LONG" ? this.short : this.long;
    if (position && position.active && opposite) {
      await this.orderManager.placeOrder({
        symbol: this.symbol,
        side: side === "LONG" ? "SELL" : "BUY",
        type: "STOP_MARKET",
        quantity: this.quantity,
        stopPrice: opposite.stop,
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
