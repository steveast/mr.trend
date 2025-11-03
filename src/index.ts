import { run } from "./app";

async function main() {
  run().catch(e => {
    console.error(e);
  });
  process.on("SIGINT", async () => {
    console.log("\nОстановка...");
    process.exit(0);
  });
}

main().catch(err => {
  console.error("Критическая ошибка:", err);
  process.exit(1);
});
