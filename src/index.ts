import { MrTrendBot } from "./bot/MrTrendBot";
import "dotenv/config";

const bot = new MrTrendBot();

bot.start();

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("Shutting down...");
  bot.stop();
  process.exit(0);
});
