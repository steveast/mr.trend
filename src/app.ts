import { USDMClient } from "binance";
import { OrderManager } from "./order-manager";
require("dotenv").config();

export class MrTrend {
  private $: USDMClient;
  private orderManager;

  constructor() {
    this.$ = new USDMClient({
      api_key: process.env.API_KEY!,
      api_secret: process.env.API_SECRET!,
      testnet: true, // ставь false для реальной торговли
    });
    this.orderManager = new OrderManager(this.$);
  }

  public run() {
    console.log(1);
  }
}
