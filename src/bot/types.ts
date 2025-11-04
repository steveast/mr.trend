export interface IRealOrder {
  symbol: string; // "BTCUSDT"
  orderId: number; // 8453226961
  clientOrderId: string; // "x‑15PC4ZJyQmDSnWIHzvcDefgTNckHO8"

  side: "BUY" | "SELL"; // "BUY"
  positionSide?: "LONG" | "SHORT" | "BOTH"; // "LONG" (если Hedge Mode)
  type: "MARKET" | "LIMIT" | "STOP" | "STOP_MARKET" | "TAKE_PROFIT" | "TAKE_PROFIT_MARKET" | string; // "MARKET"
  timeInForce?: "GTC" | "IOC" | "FOK"; // "GTC"

  price: number; // 103920  — в некоторых ответах это строка, здесь number
  avgPrice: number; // 103920
  origQty: number; // 0.01
  executedQty: number; // 0.01
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "EXPIRED" | "EXPIRED_IN_MATCH"; // "FILLED"

  stopPrice?: number; // 0
  workingType?: "CONTRACT_PRICE" | "MARK_PRICE"; // "CONTRACT_PRICE"
  reduceOnly?: boolean; // false
  closePosition?: boolean; // false
  priceProtect?: boolean; // false

  // Дополнительные поля (если есть)
  origType?: string; // "MARKET"
  updateTime?: number; // timestamp ms
  time?: number; // timestamp ms
  cumQuote?: number; // 0 — если есть

  // Поля вне официальной доки или пользовательские
  commissionAmount?: number; // 0.41568
  commissionAsset?: string; // "USDT"
  tradeId?: number; // 404274801
  priceMatch?: string; // "NONE"
  selfTradePreventionMode?: string; // "EXPIRE_MAKER"
  goodTillDate?: number; // 0
}
