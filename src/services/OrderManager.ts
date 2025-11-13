import { FuturesPositionV3, NewFuturesOrderParams, USDMClient } from "binance";
import { roundToFixed } from "../utils/roundToFixed";

export interface OrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET" | "TAKE_PROFIT";
  quantity: number;
  price?: number;
  positionSide?: "SHORT" | "LONG";
  stopPrice?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
}

export interface IPosition {
  long: undefined | FuturesPositionV3;
  short: undefined | FuturesPositionV3;
  longAmt: number;
  shortAmt: number;
}

export class OrderManager {
  private symbol = "BTCUSDT";

  constructor(public client: USDMClient) {}

  async placeOrder(params: NewFuturesOrderParams<number>) {
    try {
      const fullOrderProps: any = Object.fromEntries(
        Object.entries({
          symbol: params.symbol,
          side: params.side,
          type: params.type,
          positionSide: params.positionSide,
          quantity: params.quantity ? roundToFixed(params.quantity, 3) : undefined,
          price: params.price ? roundToFixed(params.price, 1) : undefined,
          stopPrice: params.stopPrice ? roundToFixed(params.stopPrice, 1) : undefined,
          timeInForce: params.timeInForce,
          closePosition: params.closePosition,
        } as any).filter(([_, v]) => v !== undefined)
      );

      if (params.type === "STOP_MARKET" || params.type === "TAKE_PROFIT_MARKET") {
        delete fullOrderProps.price;
        delete fullOrderProps.timeInForce;
      }

      const response = await this.client.submitNewOrder(fullOrderProps);

      console.log(`Order placed: ${params.side} ${params.type} @ ${params.price || params.stopPrice || params.quantity}`);
      return response;
    } catch (error: any) {
      console.error("Order error:", error.body?.msg || error.message);
      throw error;
    }
  }

  async cancelAll(symbol: string) {
    try {
      await this.client.cancelAllOpenOrders({ symbol });
    } catch (error: any) {
      console.error("Cancel error:", error.body?.msg || error.message);
    }
  }

  async cancelOrder(symbol: string, orderId: string) {
    try {
      await this.client.cancelOrder({ symbol, orderId: Number(orderId) });
      console.log(`Order cancelled: ID=${orderId}`);
    } catch (error: any) {
      console.error("Cancel single order error:", error.body?.msg || error.message);
    }
  }

  async getPosition() {
    const positions = await this.client.getPositionsV3();
    const symbolPositions = positions.filter(p => p.symbol === this.symbol);

    const long = symbolPositions.find(p => p.positionSide === "LONG");
    const short = symbolPositions.find(p => p.positionSide === "SHORT");
    const longAmt = parseFloat((long?.positionAmt as any) || "0");
    const shortAmt = parseFloat((short?.positionAmt as any) || "0");

    return {
      long,
      short,
      longAmt,
      shortAmt,
    };
  }

  async ensureHedgeMode() {
    try {
      const res = await this.client.setPositionMode({ dualSidePosition: "true" }); // boolean, а не "true"

      if (res && res.msg === "success") {
        console.log("✅ Hedge mode включён");
      } else {
        console.log("❌ Не удалось включить Hedge mode:", res);
      }
    } catch ({ code, message }: any) {
      if (code === -4059) {
        console.log("Hedge mode уже активен");
      } else {
        console.error("Ошибка hedge mode:", message);
      }
    }
  }

  async setLeverage(leverage: number = 20, positionSide?: "LONG" | "SHORT") {
    try {
      const params: any = { symbol: this.symbol, leverage };
      if (positionSide) {
        params.positionSide = positionSide; // Обязательно в Hedge Mode
      }

      const res = await this.client.setLeverage(params); // Правильный метод
      console.log(`Leverage ${leverage}x set for ${this.symbol} ${positionSide || "(both)"}`);
      return res;
    } catch (error: any) {
      console.error("Set leverage error:", error.body?.msg || error.message);
      throw error;
    }
  }

  async ensureIsolatedMargin() {
    try {
      await this.client.setMarginType({ symbol: this.symbol, marginType: "ISOLATED" }); // Правильно
      console.log("Switched to ISOLATED margin");
    } catch (error: any) {
      if (error.body?.code === -4046) {
        console.log("Already in ISOLATED margin");
      } else {
        console.error("Margin type error:", error.body?.msg || error.message);
        throw error;
      }
    }
  }
}
