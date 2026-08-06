import { prisma } from '../config/db';
import { bot } from './telegramBot';
import { fetchYouTubeNicheTrends } from './youtubeTrendsService';
import { generateAITrendDigest } from './aiService';
import { Markup } from 'telegraf';

/**
 * Execute Live Mode trend scan & dispatch verified trend news digest to active Live Mode users.
 */
export const runLiveModeScanner = async (specificChatId?: string): Promise<void> => {
  console.log('📡 Running Live Mode YouTube trend scanner...');

  try {
    const users = await prisma.user.findMany({
      where: (specificChatId ? { telegramChatId: specificChatId } : { liveModeEnabled: true }) as any,
      include: { channels: true },
    });

    for (const user of users) {
      const uAny = user as any;
      if (!user.telegramChatId || !uAny.channels || uAny.channels.length === 0) continue;

      const channel = uAny.channels[0];
      const nicheQuery = channel.title || 'Gaming Technology';

      console.log(`🔍 Live Mode scanning trends for channel "${channel.title}"...`);

      // 1. Fetch YouTube-specific niche trends & autocomplete search keywords
      const trends = await fetchYouTubeNicheTrends(user.id, nicheQuery);
      if (trends.length === 0) continue;

      // 2. Pass raw trends to AI for verification & market intelligence digest
      const digestItems = await generateAITrendDigest(
        trends.map((t) => ({ title: t.title, snippet: t.snippet, keywords: t.keywords })),
        nicheQuery
      );

      // 3. Format clean text digest
      let digestText =
        `⚡ <b>LIVE MODE: Verified Niche Trends &amp; News Digest</b>\n` +
        `Channel: <b>${channel.title}</b>\n\n` +
        `🔥 <b>Top Confirmed Market Trends &amp; News:</b>\n\n`;

      digestItems.forEach((item, index) => {
        digestText +=
          `${index + 1}. 🔥 <b>${item.topic}</b>\n` +
          `• <b>Why it's trending:</b> ${item.trendReason}\n` +
          `• 💡 <b>Video Idea:</b> <i>"${item.videoIdea}"</i>\n` +
          `• 🏷️ <b>Keywords:</b> <code>${item.keywords.join(', ')}</code>\n\n`;
      });

      digestText += `<i>Tap ⚡ Trigger Instant Scan to refresh trends anytime!</i>`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('⚡ Trigger Instant Scan', 'cmd_live_scan'),
          Markup.button.callback('🏠 Back to Start', 'cmd_start'),
        ],
      ]);

      try {
        await bot.telegram.sendMessage(user.telegramChatId, digestText, { parse_mode: 'HTML', ...keyboard });
        console.log(`✅ Live Mode trend digest sent to user ${user.telegramChatId}`);
      } catch (tgErr: any) {
        console.warn(`⚠️ Could not send Live Mode trend digest to Telegram:`, tgErr.message);
      }

      await new Promise((r) => setTimeout(r, 250)); // Rate limit buffer
    }
  } catch (err: any) {
    console.error('❌ Error in Live Mode scanner:', err.message);
  }
};
