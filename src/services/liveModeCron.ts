import { prisma } from '../config/db';
import { bot } from './telegramBot';
import { fetchYouTubeNicheTrends } from './youtubeTrendsService';
import { generateAIContentSuggestion, AIContentSuggestion } from './aiService';
import { Markup } from 'telegraf';

// Transient cache of generated suggestions: Key = suggestionId
export const suggestionCacheMap = new Map<string, AIContentSuggestion>();

/**
 * Execute Live Mode trend scan & dispatch post suggestions to active Live Mode users.
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

      // 1. Fetch YouTube-specific niche trends & autocomplete keywords
      const trends = await fetchYouTubeNicheTrends(user.id, nicheQuery);
      if (trends.length === 0) continue;

      const topTrend = trends[0];

      // 2. Generate complete video suggestion via AI
      const suggestion = await generateAIContentSuggestion(topTrend.title, topTrend.keywords, nicheQuery);

      const sugId = `sug_${Date.now()}`;
      suggestionCacheMap.set(sugId, suggestion);

      // 3. Dispatch Post Suggestion Card to Telegram
      const caption =
        `⚡ <b>LIVE MODE: New YouTube Video Concept Found!</b>\n\n` +
        `🔥 <b>Trending Topic:</b> ${topTrend.title}\n` +
        `💡 <b>Why it's trending:</b> ${suggestion.trendReason}\n\n` +
        `🎬 <b>Suggested Video Title:</b>\n"${suggestion.title}"\n\n` +
        `📝 <b>Suggested Description Hook:</b>\n${suggestion.description}\n\n` +
        `🏷️ <b>High-Volume YouTube Tags:</b>\n<code>${suggestion.tags.join(', ')}</code>`;

      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📌 Save Suggestion', `save_${sugId}`),
          Markup.button.callback('🔄 Regenerate', `regen_${sugId}`),
          Markup.button.callback('❌ Dismiss', `dismiss_${sugId}`),
        ],
      ]);

      try {
        if (suggestion.thumbnailUrl.startsWith('data:image')) {
          const base64Data = suggestion.thumbnailUrl.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          await bot.telegram.sendPhoto(user.telegramChatId, { source: buffer }, { caption, parse_mode: 'HTML', ...keyboard });
        } else {
          await bot.telegram.sendPhoto(user.telegramChatId, suggestion.thumbnailUrl, { caption, parse_mode: 'HTML', ...keyboard });
        }
        console.log(`✅ Live Mode post suggestion sent to user ${user.telegramChatId}`);
      } catch (tgErr: any) {
        console.warn(`⚠️ Could not send Live Mode suggestion to Telegram:`, tgErr.message);
      }
    }
  } catch (err: any) {
    console.error('❌ Error in Live Mode scanner:', err.message);
  }
};
