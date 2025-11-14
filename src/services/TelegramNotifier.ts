// src/services/TelegramNotifier.ts
import fetch from 'cross-fetch';

export class TelegramNotifier {
  private readonly token: string;
  private readonly chatId: string;
  private readonly enabled: boolean;

  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN || '';
    this.chatId = process.env.TELEGRAM_CHAT_ID || '';
    this.enabled = !!this.token && !!this.chatId;
  }

  private async send(text: string): Promise<void> {
    // === ВЫВОД В КОНСОЛЬ ===
    console.log(`\x1b[36m[Telegram]\x1b[0m ${text.replace(/<[^>]*>/g, '').trim()}`);
    if (!this.enabled) return;

    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const payload = {
      chat_id: this.chatId,
      text,
      parse_mode: 'HTML' as const,
      disable_web_page_preview: true,
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        console.warn('Telegram API error:', err);
      }
    } catch (err: any) {
      console.warn('Telegram send failed:', err.message);
    }
  }

  // === УВЕДОМЛЕНИЯ С LOG ===

  botStarted(testnet: boolean) {
    const msg = `
<b>Mr. Trend Bot Запущен</b>
<b>Сеть:</b> ${testnet ? 'TESTNET' : 'MAINNET'}
<b>Символ:</b> BTCUSDT
<b>Время:</b> ${new Date().toLocaleString('ru')}
    `.trim();

    this.send(msg);
  }

  orderFilled(order: any) {
    const profit = order.realisedProfit >= 0 ? '' : '';
    const msg = `
<b>Ордер исполнен</b>
<b>Сторона:</b> ${order.side}
<b>Тип:</b> ${order.type}
<b>Цена:</b> $${order.price.toFixed(2)}
<b>Кол-во:</b> ${order.qty}
<b>P&L:</b> ${profit}$${Math.abs(order.realisedProfit).toFixed(4)}
<b>Комиссия:</b> ${order.commissionAmount} ${order.commissionAsset}
    `.trim();

    this.send(msg);
  }

  cycleCompleted() {
    const msg = `
<b>Цикл завершён</b>
<b>Итог P&L:</b> TODO
<b>Готов к новому входу...</b>
    `.trim();

    this.send(msg);
  }

  error(message: string) {
    const msg = `
<b>Ошибка в боте</b>
${message}
    `.trim();

    this.send(msg);
  }
}
