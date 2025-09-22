import { env } from '../utils/env.js';
import { logger } from '../utils/logger.js';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

type TelegramParseMode = 'MarkdownV2' | 'HTML' | 'Markdown';

export interface TelegramMessageOptions {
  parseMode?: TelegramParseMode;
  disableNotification?: boolean;
}

export async function notifyTelegram(message: string, options: TelegramMessageOptions = {}): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    logger.warn('Telegram credentials missing; skipping notification');
    return;
  }
  const payload = {
    chat_id: env.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: options.parseMode ?? 'Markdown',
    disable_notification: options.disableNotification ?? false
  };

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, body: text }, 'Failed to send Telegram notification');
  }
}
