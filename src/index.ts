import { MrTrendBot } from "./bot/MrTrendBot";
import "dotenv/config";

const bot = new MrTrendBot(true); // true = Testnet

bot.start();

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await bot.stop();
  process.exit(0);
});
