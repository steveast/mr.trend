import { MainClient } from "binance";
import { EventEmitter } from "events";

export class WebSocketManager extends EventEmitter {
  private client: MainClient;
  private stream: any;

  constructor() {
    super();
    this.client = new MainClient({});
  }

  start(symbol: string = "BTCUSDT") {
    const streamName = `${symbol.toLowerCase()}@markPrice@1s`;
    this.stream = this.client.subscribe(streamName);

    this.stream.then((socket: any) => {
      socket.on("message", (data: any) => {
        const markPrice = parseFloat(data.markPrice);
        this.emit("price", markPrice);
      });

      socket.on("close", () => {
        console.log("WebSocket closed. Reconnecting...");
        setTimeout(() => this.start(symbol), 1000);
      });
    });
  }

  stop() {
    this.stream?.then((socket: any) => socket.close());
  }
}
