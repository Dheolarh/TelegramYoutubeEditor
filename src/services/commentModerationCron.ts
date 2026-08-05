import filter from 'leo-profanity';
import { prisma } from '../config/db';
import { bot } from './telegramBot';
import { fetchVideoComments, deleteYouTubeComment } from './youtubeEdit';

// Load default English profanity dictionary from npm library
filter.loadDictionary('en');

/**
 * Multi-layer Profanity, Spam & Toxicity Detector
 * Uses npm 'leo-profanity' library + link/spam regex.
 */
export const isProfaneOrToxic = (text: string): boolean => {
  // 1. Check npm library dictionary (catches profanity, bad words, and common variations)
  if (filter.check(text)) return true;

  // 2. Check link spam & sub4sub promotion
  const spamPattern = /\b(free subscribers|sub4sub|crypto giveaway|whatsapp me|telegram me)\b|http[s]?:\/\/[^\s]+/i;
  return spamPattern.test(text);
};

/**
 * Background Cron Job: Scans connected channel videos for profane comments and deletes them.
 */
export const runCommentModerationScanner = async (specificChatId?: string): Promise<void> => {
  console.log('🛡️ Running Automated Comment Moderation Scanner...');

  try {
    const users = await prisma.user.findMany({
      where: (specificChatId ? { telegramChatId: specificChatId } : { commentModerationEnabled: true }) as any,
      include: { channels: true, youtubeAccounts: true },
    });

    for (const user of users) {
      const uAny = user as any;
      if (!user.telegramChatId || !uAny.channels || uAny.channels.length === 0) continue;

      const userVideos = await prisma.video.findMany({
        where: { channelId: uAny.channels[0].id },
        take: 5,
        orderBy: { createdAt: 'desc' },
      });

      let totalDeleted = 0;
      const deletedLogs: { videoTitle: string; author: string; commentText: string }[] = [];

      for (const video of userVideos) {
        try {
          const comments = await fetchVideoComments(user.id, video.youtubeVideoId, 10);

          for (const c of comments) {
            if (isProfaneOrToxic(c.textDisplay)) {
              console.log(`🗑️ Deleting profane comment by ${c.authorName}: "${c.textDisplay}"`);
              await deleteYouTubeComment(user.id, c.commentId);
              totalDeleted++;
              deletedLogs.push({
                videoTitle: video.title,
                author: c.authorName,
                commentText: c.textDisplay,
              });
            }
          }
        } catch (err: any) {
          // Ignore videos with disabled comments
        }
      }

      if (totalDeleted > 0) {
        const alertText =
          `🛡️ <b>Automated Comment Moderation Alert</b>\n\n` +
          `Deleted <b>${totalDeleted}</b> profane/toxic comment(s) from your YouTube channel:\n\n` +
          deletedLogs
            .map(
              (l) =>
                `• 🎬 <b>Video:</b> "${l.videoTitle}"\n` +
                `  👤 <b>Author:</b> ${l.author}\n` +
                `  💬 <b>Removed Content:</b> <s>${l.commentText}</s>`
            )
            .join('\n\n');

        await bot.telegram.sendMessage(user.telegramChatId, alertText, { parse_mode: 'HTML' });
      }
    }
  } catch (err: any) {
    console.error('❌ Error in Comment Moderation scanner:', err.message);
  }
};
