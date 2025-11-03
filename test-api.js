// test-api.js
const OrderManager = require('./orderManager');
const config = require('./config');

(async () => {
  console.log('Testnet:', config.testnet);
  await OrderManager.initTickSize();

  try {
    const positions = await OrderManager.getPosition('LONG');
    console.log('Позиции:', positions);
  } catch (err) {
    console.error('Ошибка:', err.message);
  }
})();