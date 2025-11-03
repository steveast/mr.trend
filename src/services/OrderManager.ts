import { USDMClient } from "binance";

export interface OrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP_MARKET" | "TAKE_PROFIT_MARKET";
  quantity: number;
  price?: number;
  positionSide?: "SHORT" | "LONG";
  stopPrice?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
  reduceOnly?: boolean;
}

export class OrderManager {
  constructor(public client: USDMClient) {}

  async placeOrder(params: OrderParams) {
    try {
      const fullOrderProps: any = Object.fromEntries(
        Object.entries({
          symbol: params.symbol,
          side: params.side,
          type: params.type,
          positionSide: params.side === "SELL" ? "SHORT" : "LONG",
          quantity: params.quantity.toFixed(3),
          price: params.price?.toFixed(2),
          stopPrice: params.stopPrice?.toFixed(2),
          // timeInForce: params.timeInForce || "GTC",
          reduceOnly: params.reduceOnly,
        } as any).filter(([_, v]) => v !== undefined)
      );

      if (
        params.type === "STOP_MARKET" ||
        params.type === "TAKE_PROFIT_MARKET"
      ) {
        delete fullOrderProps.price;
        delete fullOrderProps.timeInForce;
      }
      console.log("Gonna set", fullOrderProps);

      const response = await this.client.submitNewOrder(fullOrderProps);

      console.log(
        `Order placed: ${params.side} ${params.type} @ ${params.price || params.stopPrice}`
      );
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
}
