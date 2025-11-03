// main.js
const TradingBot = require("./bot");

async function main() {
  const bot = new TradingBot();

  process.on("SIGINT", async () => {
    console.log("\nОстановка...");
    await bot.stop();
    process.exit(0);
  });

  await bot.start();
}

main().catch(err => {
  console.error("Критическая ошибка:", err);
  process.exit(1);
});
