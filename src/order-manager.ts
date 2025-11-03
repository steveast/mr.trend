import { USDMClient } from "binance";

export class OrderManager {
  private $: USDMClient;

  constructor(client: USDMClient) {
    this.$ = client;
  }
}
