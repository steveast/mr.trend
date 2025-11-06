// src/services/UserDataStreamManager.ts

import { WebsocketClient } from "binance";
import { USDMClient } from "binance";
import { EventEmitter } from "events";

export class UserDataStreamManager extends EventEmitter {
  private ws: WebsocketClient | null = null;
  private listenKey: string | null = null;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor(
    private client: USDMClient,
    testnet: boolean = true
  ) {
    super();
    this.ws = new WebsocketClient({
      wsUrl: testnet ? "wss://stream.binancefuture.com" : "wss://fstream.binance.com",
      beautify: testnet,
      api_key: process.env.API_KEY, 
      api_secret: process.env.API_SECRET,
      testnet,
    });
  }

  async start() {
    try {
      this.ws!.subscribeUsdFuturesUserDataStream();

      this.ws!.on("formattedMessage", (data: any) => {
        if (data.eventType === "ORDER_TRADE_UPDATE") {
          const order = data.order;
          // console.log('ORDER ORIGINAL', order);
          if (order.executionType === "TRADE" && order.orderStatus === "FILLED") {
            this.emit("orderFilled", {
              symbol: order.symbol,
              side: order.orderSide, // SELL
              type: order.orderType, // LIMIT
              price: parseFloat(order.lastFilledPrice || "0"),
              qty: parseFloat(order.lastFilledQuantity || "0"),
              // ...order,
              // {
              //   symbol: 'BTCUSDT',
              //   clientOrderId: 'x-15PC4ZJy8nE4D-0iptiEBvXEALHNK3',
              //   orderSide: 'SELL',
              //   orderType: 'LIMIT',
              //   timeInForce: 'GTC',
              //   originalQuantity: 0.001,
              //   originalPrice: 103508.7,
              //   averagePrice: 103508.7,
              //   stopPrice: 0,
              //   executionType: 'TRADE',
              //   orderStatus: 'FILLED',
              //   orderId: 8850365284,
              //   lastFilledQuantity: 0.001,
              //   orderFilledAccumulatedQuantity: 0.001,
              //   lastFilledPrice: 103508.7,
              //   commissionAmount: 0.02070174,
              //   commissionAsset: 'USDT',
              //   orderTradeTime: 1762435544251,
              //   tradeId: 405072038,
              //   bidsNotional: 0,
              //   asksNotional: 0,
              //   isMakerTrade: true,
              //   isReduceOnly: true,
              //   stopPriceWorkingType: 'CONTRACT_PRICE',
              //   originalOrderType: 'LIMIT',
              //   positionSide: 'LONG',
              //   isCloseAll: false,
              //   realisedProfit: 0.0265,
              //   pP: false,
              //   strategyId: 0,
              //   ss: 0,
              //   selfTradePrevention: 'EXPIRE_MAKER',
              //   priceMatch: 'NONE',
              //   goodTillDate: 0
              // }
            });
          }
        }
      });

      this.keepAliveInterval = setInterval(
        async () => {
          if (this.listenKey) {
            try {
              await this.client.keepAliveFuturesUserDataListenKey();
              console.log("ListenKey renewed");
            } catch (err) {
              console.error("Keep-alive failed:", err);
            }
          }
        },
        25 * 60 * 1000
      );
    } catch (error: any) {
      console.error("UserDataStream start error:", error.message);
    }
  }

  stop() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.listenKey) {
      try {
        this.client.closeFuturesUserDataListenKey();
      } catch (err) {}
      this.listenKey = null;
    }
    if (this.ws) {
      this.ws.closeAll(true);
      this.ws = null;
    }
    console.log("User Data Stream stopped");
  }
}
