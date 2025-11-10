import { MrTrendBot } from "./bot/MrTrendBot";
import "dotenv/config";

const bot = new MrTrendBot(process.env.TESTNET === "true"); // true = Testnet
console.log("Is TESTNET: ", process.env.TESTNET === "true");

bot.start();

process.on("SIGINT", async () => {
  console.log("\nShutting down...");
  await bot.stop();
  process.exit(0);
});
