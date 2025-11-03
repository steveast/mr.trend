import { USDMClient } from "binance";
require("dotenv").config();

export class MrTrend {
  private $;

  constructor() {
    this.$ = new USDMClient({
      api_key: process.env.API_KEY!,
      api_secret: process.env.API_SECRET!,
      testnet: true, // ставь false для реальной торговли
    });
  }
}
