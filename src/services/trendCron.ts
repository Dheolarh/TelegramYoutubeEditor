import { prisma } from '../config/db';
import { bot } from './telegramBot';
import { generateAITitles } from './aiService';

/**
 * Background Cron Job: Scans connected channel videos periodically (every 6 hours)
 * and dispatches proactive Telegram trend alerts.
 */
export const runTrendAlertScanner = async (): Promise<void> => {
  console.log('🔍 Running background trend alert scanner...');

  try {
    const channels = await prisma.channel.findMany({
      include: { user: true, videos: true },
    });

    for (const channel of channels) {
      const ownerChatId = channel.user.telegramChatId;
      if (!ownerChatId || channel.videos.length === 0) continue;

      // Find an older video that hasn't been updated recently
      const olderVideo = channel.videos[0];
      if (!olderVideo) continue;

      try {
        const result = await generateAITitles(
          olderVideo.title,
          olderVideo.description || '',
          olderVideo.tags
        );

        if (result.titles.length > 0) {
          const alertMsg =
            `🔥 *Proactive Trend Alert!*\n\n` +
            `Topics related to your video "*${olderVideo.title}*" are currently trending!\n\n` +
            `💡 *AI Recommended Title:* "${result.titles[0]}"\n\n` +
            `Use /videos to review and update your video metadata!`;

          await bot.telegram.sendMessage(ownerChatId, alertMsg, { parse_mode: 'Markdown' });
          console.log(`✅ Dispatched trend alert for video "${olderVideo.title}" to ${ownerChatId}`);
        }
      } catch (err: any) {
        console.warn(`⚠️ Trend scan warning for video ${olderVideo.title}:`, err.message);
      }
    }
  } catch (error: any) {
    console.error('❌ Error in trend scanner:', error.message);
  }
};
