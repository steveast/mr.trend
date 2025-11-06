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

      console.log(`Order placed: ${params.side} ${params.type} @ ${params.price || params.quantity}`);
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
}
