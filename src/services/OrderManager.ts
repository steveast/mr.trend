import { USDMClient } from "binance";

export interface OrderParams {
  symbol: string;
  side: "BUY" | "SELL";
  type: "LIMIT" | "MARKET" | "STOP" | "TAKE_PROFIT";
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce?: "GTC" | "IOC" | "FOK";
}

export class OrderManager {
  constructor(private client: USDMClient) {}

  async placeOrder(params: OrderParams) {
    try {
      const response = await this.client.submitNewOrder({
        symbol: params.symbol,
        side: params.side,
        type: params.type,
        quantity: params.quantity.toFixed(6),
        price: params.price?.toFixed(2),
        stopPrice: params.stopPrice?.toFixed(2),
        timeInForce: params.timeInForce || "GTC",
      });
      console.log(
        `Order placed: ${params.side} ${params.type} @ ${params.price || params.stopPrice}`
      );
      return response;
    } catch (error: any) {
      console.error("Order error:", error.message);
    }
  }

  async cancelAll(symbol: string) {
    await this.client.cancelAllOpenOrders({ symbol });
  }
}
