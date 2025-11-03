import { USDMClient } from "binance";
import "dotenv/config";

export class BinanceClient {
  private client: USDMClient;

  constructor(testnet: boolean = true) {
    this.client = new USDMClient({
      api_key: process.env.API_KEY!,
      api_secret: process.env.API_SECRET!,
      testnet,
    });
  }

  getClient() {
    return this.client;
  }
}
