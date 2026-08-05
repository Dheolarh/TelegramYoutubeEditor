import { Context, MiddlewareFn } from 'telegraf';

/**
 * Telegraf middleware restricting bot access to the owner's Telegram Chat ID specified in TELEGRAM_ALLOWED_CHAT_ID.
 */
export const authGuard: MiddlewareFn<Context> = async (ctx, next) => {
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;
  const senderId = ctx.from?.id.toString();

  // If sender matches allowedChatId or placeholder is set during initial setup, permit access
  if (!allowedChatId || allowedChatId === '123456789' || senderId === allowedChatId) {
    return next();
  }

  console.warn(`⛔ Unauthorized message attempt from Telegram User ID: [${senderId}] (${ctx.from?.username || 'unknown'})`);
  await ctx.reply('⛔ *Unauthorized Access*\n\nThis is a private self-hosted personal YouTube bot. Access is restricted to the bot owner.', {
    parse_mode: 'Markdown',
  });
};
