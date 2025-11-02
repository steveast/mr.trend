const config = require('./config');
const TradingBot = require('./bot');

async function main() {
  const bot = new TradingBot(config.symbols);  // Масштаб: все символы из конфига

  bot.on('error', err => {
    console.error('Bot Error:', err);
    process.exit(1);
  });

  await bot.start();

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nЗавершение...');
    bot.stop();
    process.exit(0);
  });
}

main().catch(console.error);