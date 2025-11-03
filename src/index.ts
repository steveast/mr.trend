
async function main() {
  process.on('SIGINT', async () => {
    console.log('\nОстановка...');
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Критическая ошибка:', err);
  process.exit(1);
});