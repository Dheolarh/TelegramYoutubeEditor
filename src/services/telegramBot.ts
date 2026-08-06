import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import axios from 'axios';
import { authGuard } from '../middleware/authGuard';
import { prisma } from '../config/db';
import { fetchRecentVideos, searchChannelVideos, formatCount } from './youtubeVideos';
import {
  updateVideoTitle,
  updateVideoDescription,
  updateVideoTags,
  updateVideoThumbnail,
  fetchVideoComments,
  replyToComment,
  postAndPinComment,
} from './youtubeEdit';
import {
  generateAITitles,
  generateAIDescription,
  generateAITags,
  generateAIPinnedComment,
  generateAIThumbnail,
} from './aiService';
import { getGoogleAuthUrl } from './youtubeAuth';
import { runLiveModeScanner } from './liveModeCron';
import { fetchChannelAnalytics } from './youtubeAnalytics';
import { runCommentModerationScanner } from './commentModerationCron';


dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken || botToken === 'your_telegram_bot_token_here') {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN is not set in .env.');
}

export const bot = new Telegraf(botToken || 'dummy_token_for_build');

bot.use(authGuard);

interface UserState {
  action:
    | 'AWAITING_TITLE'
    | 'AWAITING_DESC'
    | 'AWAITING_TAGS'
    | 'AWAITING_THUMBNAIL'
    | 'AWAITING_COMMENT_REPLY'
    | 'AWAITING_THUMB_CUSTOM'
    | 'AWAITING_PINNED_COMMENT';
  videoId: string;
  youtubeVideoId: string;
  extraData?: any;
}

const userStateMap = new Map<string, UserState>();

const getConnectedChannel = async (telegramChatId: string) => {
  try {
    // 1. Try finding user by current Telegram chat ID
    let user = await prisma.user.findUnique({
      where: { telegramChatId },
      include: { channels: true, youtubeAccounts: true },
    });

    // 2. Fallback: try owner TELEGRAM_ALLOWED_CHAT_ID or first user in DB (for self-hosted single owner)
    if ((!user || user.channels.length === 0) && process.env.TELEGRAM_ALLOWED_CHAT_ID) {
      user = await prisma.user.findUnique({
        where: { telegramChatId: process.env.TELEGRAM_ALLOWED_CHAT_ID },
        include: { channels: true, youtubeAccounts: true },
      });
    }

    if (!user || user.channels.length === 0) {
      const firstUser = await prisma.user.findFirst({
        include: { channels: true, youtubeAccounts: true },
      });
      if (firstUser && firstUser.channels.length > 0) {
        user = firstUser;
      }
    }

    if (!user || user.channels.length === 0) return null;
    return { user, channel: user.channels[0], account: user.youtubeAccounts[0] };
  } catch (err: any) {
    console.warn('⚠️ DB error in getConnectedChannel:', err.message);
    return null;
  }
};

// ── /start ────────────────────────────────────────────────────────────────────
const handleStartCommand = async (ctx: any) => {
  const telegramChatId = ctx.from.id.toString();
  const firstName = ctx.from.first_name || 'Creator';

  // Short clean URL: /auth/connect?uid=<chatId> → redirects to Google OAuth
  const baseUrl = process.env.GOOGLE_REDIRECT_URI?.replace('/auth/google/callback', '') ||
    'http://localhost:3000';
  const connectUrl = `${baseUrl}/auth/connect?uid=${telegramChatId}`;

  const connData = await getConnectedChannel(telegramChatId);

  if (connData) {
    const text =
      `👋 <b>Welcome back, ${firstName}!</b>\n\n` +
      `✅ <b>Connected Channel:</b> ${connData.channel.title} (${connData.channel.subscriberCount.toLocaleString()} subs)\n\n` +
      `Use /videos to browse uploads or /search to find a video.`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('📹 Browse Recent Videos', 'cmd_videos')],
        [
          Markup.button.url('🔗 Re-Connect', connectUrl),
          Markup.button.callback('🔌 Disconnect', 'cmd_disconnect'),
        ],
        [Markup.button.callback('❓ Help & Commands', 'cmd_help')],
      ]),
    });
  } else {
    const text =
      `👋 <b>Welcome to your Personal YouTube Assistant, ${firstName}!</b>\n\n` +
      `Manage, edit metadata, reply to comments, and AI-optimize your YouTube channel directly from Telegram.`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🔗 Connect YouTube Channel', connectUrl)],
        [Markup.button.callback('❓ Help & Commands', 'cmd_help')],
      ]),
    });
  }
};

bot.command('start', handleStartCommand);
bot.action('cmd_start', async (ctx) => { await ctx.answerCbQuery(); await handleStartCommand(ctx); });

// ── Disconnect Action ─────────────────────────────────────────────────────────
bot.action('cmd_disconnect', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);

  if (!connData) {
    return ctx.reply('⚠️ <b>No YouTube channel connected to disconnect.</b>', { parse_mode: 'HTML' });
  }

  try {
    await prisma.channel.deleteMany({ where: { userId: connData.user.id } });
    await prisma.youTubeAccount.deleteMany({ where: { userId: connData.user.id } });

    await ctx.reply(
      `🔌 <b>YouTube Channel Disconnected!</b>\n\n` +
        `Your channel <b>${connData.channel.title}</b> has been unlinked from this bot.\n\n` +
        `Use /start anytime to connect a new YouTube channel!`,
      { parse_mode: 'HTML' }
    );
  } catch (err: any) {
    await ctx.reply(`❌ <b>Disconnect Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// ── /help ─────────────────────────────────────────────────────────────────────
const handleHelpCommand = async (ctx: any) => {
  const text =
    `🤖 <b>Personal YouTube Bot Help &amp; Commands</b>\n\n` +
    `• <b>/start</b> - Welcome &amp; Channel Connection Status\n` +
    `• <b>/videos</b> - Browse &amp; manage your recent uploads\n` +
    `• <b>/analytics</b> - Real-time channel analytics, CTR &amp; demographics\n` +
    `• <b>/search &lt;keyword&gt;</b> - Search your videos by title\n` +
    `• <b>/livemode</b> - Real-time YouTube trend &amp; post suggestion engine\n` +
    `• <b>/moderation</b> - Automated profanity &amp; spam comment cleaner\n` +
    `• <b>/help</b> - Show this help menu\n\n` +
    `<b>Available Video Features:</b>\n` +
    `✏️ Edit Titles, Descriptions &amp; Tags\n` +
    `🖼️ Upload Thumbnails by sending photos\n` +
    `💬 View &amp; Reply to top comments\n` +
    `🤖 AI-Powered Metadata Optimization (Gemini / DeepSeek)\n` +
    `📊 YouTube Analytics API v2 Dashboard\n` +
    `⚡ Live Mode Automated Trend Scanner\n` +
    `🛡️ Automated Comment Moderation Engine`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📹 Browse Videos', 'cmd_videos'), Markup.button.callback('📊 Analytics', 'cmd_analytics')],
      [Markup.button.callback('⚡ Live Mode', 'cmd_livemode'), Markup.button.callback('🛡️ Moderation', 'cmd_moderation')],
      [Markup.button.callback('🏠 Back to Start', 'cmd_start')],
    ]),
  });
};

bot.command('help', handleHelpCommand);
bot.action('cmd_help', async (ctx) => { await ctx.answerCbQuery(); await handleHelpCommand(ctx); });

// ── /moderation (Automated Profanity & Spam Comment Cleaner) ──────────────────
const handleModerationCommand = async (ctx: any) => {
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);

  if (!connData) {
    return ctx.reply('⚠️ <b>Connect your YouTube channel via /start first.</b>', { parse_mode: 'HTML' });
  }

  const user = await prisma.user.findUnique({ where: { telegramChatId } });
  const isEnabled = (user as any)?.commentModerationEnabled || false;

  const text = isEnabled
    ? `🛡️ <b>AUTOMATED COMMENT MODERATION ENABLED</b> 🟢\n\n` +
      `The bot is actively scanning your YouTube video comments in the background and automatically deleting profanity, toxic hate speech, and spam links.\n\n` +
      `<i>Status: Active (Scanning YouTube comments periodically)</i>`
    : `🛡️ <b>AUTOMATED COMMENT MODERATION DISABLED</b> 🔴\n\n` +
      `Automated comment moderation is currently turned off.\n\n` +
      `Turn ON Comment Moderation to automatically clean profanity, toxic comments, and spam links from your YouTube channel!`;

  const keyboard = Markup.inlineKeyboard([
    [
      isEnabled
        ? Markup.button.callback('🔴 Turn OFF Moderation', 'cmd_mod_toggle')
        : Markup.button.callback('🟢 Turn ON Moderation', 'cmd_mod_toggle'),
    ],
    [Markup.button.callback('⚡ Scan Comments Now', 'cmd_mod_scan')],
    [Markup.button.callback('🏠 Back to Start', 'cmd_start')],
  ]);

  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
};

bot.command('moderation', handleModerationCommand);
bot.action('cmd_moderation', async (ctx) => { await ctx.answerCbQuery(); await handleModerationCommand(ctx); });

bot.action('cmd_mod_toggle', async (ctx: any) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  const user = await prisma.user.findUnique({ where: { telegramChatId } });
  if (!user) return;

  const newStatus = !(user as any).commentModerationEnabled;
  await prisma.user.update({
    where: { telegramChatId },
    data: { commentModerationEnabled: newStatus } as any,
  });

  await handleModerationCommand(ctx);
});

bot.action('cmd_mod_scan', async (ctx: any) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  await ctx.reply('🛡️ <b>Scanning your YouTube comments for profanity & spam...</b>', { parse_mode: 'HTML' });
  await runCommentModerationScanner(telegramChatId);
});

// ── /analytics (YouTube Analytics API v2 Dashboard) ───────────────────────────
const handleAnalyticsCommand = async (ctx: any, days: number = 30, isEdit: boolean = false) => {
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);

  if (!connData) {
    const msg = '⚠️ <b>No YouTube channel connected yet.</b>\n\nConnect via /start.';
    return isEdit
      ? ctx.editMessageText(msg, { parse_mode: 'HTML' })
      : ctx.reply(msg, { parse_mode: 'HTML' });
  }

  try {
    const report = await fetchChannelAnalytics(connData.user.id, days);

    const text =
      `📊 <b>YouTube Channel Analytics Dashboard</b>\n` +
      `Channel: <b>${connData.channel.title}</b> (Last ${report.days} Days)\n\n` +
      `📈 <b>Performance Overview:</b>\n` +
      `• Views: <b>${formatCount(report.totalViews)}</b>\n` +
      `• Watch Time: <b>${formatCount(report.estimatedMinutesWatched)} hrs</b>\n` +
      `• Subscribers Gained: <b>+${formatCount(report.subscribersGained)}</b>\n` +
      `• Likes: <b>${formatCount(report.likes)}</b> | Comments: <b>${formatCount(report.comments)}</b>\n\n` +
      `🚦 <b>Top Traffic Sources:</b>\n` +
      report.trafficSources.map((s) => `• ${s.name}: <b>${s.percentage}%</b>`).join('\n') +
      `\n\n👥 <b>Audience Demographics:</b>\n` +
      report.demographics.map((d) => `• Age ${d.age}: <b>${d.percentage}%</b>`).join('\n') +
      `\n\n🎯 <b>AI CTR & Growth Insight:</b>\n` +
      `<i>"${report.ctrInsight}"</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📈 Last 7 Days', 'ana_7d'),
        Markup.button.callback('📊 Last 30 Days', 'ana_30d'),
        Markup.button.callback('🗓️ Last 90 Days', 'ana_90d'),
      ],
      [
        Markup.button.callback('📹 Manage Videos', 'cmd_videos'),
        Markup.button.callback('⚡ Live Mode', 'cmd_livemode'),
      ],
      [Markup.button.callback('🏠 Back to Start', 'cmd_start')],
    ]);

    if (isEdit) {
      await ctx.editMessageText(text, { parse_mode: 'HTML', ...keyboard });
    } else {
      await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
    }
  } catch (err: any) {
    await ctx.reply(`❌ <b>Analytics Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
};

bot.command('analytics', (ctx) => handleAnalyticsCommand(ctx, 30));
bot.action('cmd_analytics', async (ctx) => { await ctx.answerCbQuery(); await handleAnalyticsCommand(ctx, 30, true); });
bot.action('ana_7d', async (ctx) => { await ctx.answerCbQuery(); await handleAnalyticsCommand(ctx, 7, true); });
bot.action('ana_30d', async (ctx) => { await ctx.answerCbQuery(); await handleAnalyticsCommand(ctx, 30, true); });
bot.action('ana_90d', async (ctx) => { await ctx.answerCbQuery(); await handleAnalyticsCommand(ctx, 90, true); });

// ── /livemode (Real-Time YouTube Trend & Autocomplete Polling) ────────────────
const handleLiveModeCommand = async (ctx: any) => {
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);

  if (!connData) {
    return ctx.reply('⚠️ <b>Connect your YouTube channel via /start first.</b>', { parse_mode: 'HTML' });
  }

  const user = await prisma.user.findUnique({ where: { telegramChatId } });
  const isEnabled = (user as any)?.liveModeEnabled || false;
  const intervalHours = process.env.LIVE_MODE_INTERVAL_HOURS || '6';

  const text = isEnabled
    ? `⚡ <b>LIVE MODE ENABLED</b> 🟢\n\n` +
      `The bot is actively polling YouTube for real-time trending videos, news, and viewer search autocomplete keywords in your channel's niche (<b>${connData.channel.title}</b>).\n\n` +
      `Whenever a viral trend is detected, the AI will research it and send you complete <b>Video Post Suggestions</b> (Title + Thumbnail + Description + Tags).\n\n` +
      `<i>Status: Active (Polling YouTube every ${intervalHours} hours)</i>`
    : `⚡ <b>LIVE MODE DISABLED</b> 🔴\n\n` +
      `Automatic YouTube trend polling is currently turned off.\n\n` +
      `Turn ON Live Mode to receive proactive AI video post concepts whenever viral trends break in your YouTube niche!`;

  const keyboard = Markup.inlineKeyboard([
    [
      isEnabled
        ? Markup.button.callback('🔴 Turn OFF Live Mode', 'cmd_live_toggle')
        : Markup.button.callback('🟢 Turn ON Live Mode', 'cmd_live_toggle'),
    ],
    [Markup.button.callback('⚡ Trigger Instant Trend Scan', 'cmd_live_scan')],
  ]);

  await ctx.reply(text, { parse_mode: 'HTML', ...keyboard });
};

bot.command('livemode', handleLiveModeCommand);
bot.action('cmd_livemode', async (ctx) => { await ctx.answerCbQuery(); await handleLiveModeCommand(ctx); });

bot.action('cmd_live_toggle', async (ctx: any) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  const user = await prisma.user.findUnique({ where: { telegramChatId } });
  if (!user) return;

  const newStatus = !(user as any).liveModeEnabled;
  await prisma.user.update({
    where: { telegramChatId },
    data: { liveModeEnabled: newStatus } as any,
  });

  await handleLiveModeCommand(ctx);
});

bot.action('cmd_live_scan', async (ctx: any) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  await ctx.reply('⚡ <b>Scanning YouTube API for niche trends & autocomplete queries...</b>', { parse_mode: 'HTML' });
  await runLiveModeScanner(telegramChatId);
});

// Live Mode Post Suggestion Actions
bot.action(/^save_sug_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('📌 Suggestion saved!');
  await ctx.reply('📌 <b>Video Concept Saved to your ideas library!</b>', { parse_mode: 'HTML' });
});

bot.action(/^regen_sug_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  await ctx.reply('🔄 <b>Regenerating fresh video post concept...</b>', { parse_mode: 'HTML' });
  await runLiveModeScanner(telegramChatId);
});

bot.action(/^dismiss_sug_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery('Dismissed');
  try {
    await ctx.deleteMessage();
  } catch (e) {
    await ctx.reply('❌ <b>Dismissed.</b>', { parse_mode: 'HTML' });
  }
});


// ── /videos (Paginated Video Listing) ─────────────────────────────────────────
const VIDEOS_PER_PAGE = 10;

const renderVideoList = async (ctx: any, page: number = 1, isEdit: boolean = false) => {
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);

  if (!connData) {
    const msg = '⚠️ <b>No YouTube channel connected yet.</b>\n\nConnect via /start.';
    return isEdit
      ? ctx.editMessageText(msg, { parse_mode: 'HTML' })
      : ctx.reply(msg, { parse_mode: 'HTML' });
  }

  try {
    // Fetch up to 30 recent videos to support pagination
    const allVideos = await fetchRecentVideos(connData.user.id, connData.channel.youtubeChannelId, 30);

    if (allVideos.length === 0) {
      const msg = '📹 <b>No videos found on this channel.</b>';
      return isEdit
        ? ctx.editMessageText(msg, { parse_mode: 'HTML' })
        : ctx.reply(msg, { parse_mode: 'HTML' });
    }

    const totalPages = Math.ceil(allVideos.length / VIDEOS_PER_PAGE);
    const currentPage = Math.max(1, Math.min(page, totalPages));

    const startIndex = (currentPage - 1) * VIDEOS_PER_PAGE;
    const pageVideos = allVideos.slice(startIndex, startIndex + VIDEOS_PER_PAGE);

    let text = `📹 <b>Here are your most recent YouTube videos (Page ${currentPage}/${totalPages}):</b>\n\n`;

    const numberRow1: any[] = [];
    const numberRow2: any[] = [];

    pageVideos.forEach((v, i) => {
      const num = startIndex + i + 1;
      text += `${num}. <b>${v.title}</b> — Views: ${formatCount((v as any).viewCount || 0)}\n\n`;

      const btn = Markup.button.callback(`🎬 ${num}`, `vid_${v.id}`);
      if (i < 5) {
        numberRow1.push(btn);
      } else {
        numberRow2.push(btn);
      }
    });

    text += `\n<b>Tap a video number below to manage it:</b>`;

    // Navigation buttons row
    const navRow: any[] = [];
    if (currentPage > 1) {
      navRow.push(Markup.button.callback('⬅️ Prev', `vpage_${currentPage - 1}`));
    }
    if (currentPage < totalPages) {
      navRow.push(Markup.button.callback('➡️ Next', `vpage_${currentPage + 1}`));
    }

    const inlineButtons: any[] = [];
    if (numberRow1.length > 0) inlineButtons.push(numberRow1);
    if (numberRow2.length > 0) inlineButtons.push(numberRow2);
    if (navRow.length > 0) inlineButtons.push(navRow);

    const extra = {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(inlineButtons),
    };

    if (isEdit) {
      await ctx.editMessageText(text, extra);
    } else {
      await ctx.reply(text, extra);
    }
  } catch (err: any) {
    const msg = `❌ <b>Error:</b> ${err.message}`;
    if (isEdit) {
      await ctx.editMessageText(msg, { parse_mode: 'HTML' });
    } else {
      await ctx.reply(msg, { parse_mode: 'HTML' });
    }
  }
};

bot.command('videos', async (ctx: any) => {
  await ctx.reply('⏳ <b>Fetching your recent videos...</b>', { parse_mode: 'HTML' });
  await renderVideoList(ctx, 1, false);
});

bot.action('cmd_videos', async (ctx: any) => {
  await ctx.answerCbQuery();
  await renderVideoList(ctx, 1, false);
});

bot.action(/^vpage_(\d+)$/, async (ctx: any) => {
  await ctx.answerCbQuery();
  const page = parseInt(ctx.match[1], 10);
  await renderVideoList(ctx, page, true);
});

// ── /search ───────────────────────────────────────────────────────────────────
bot.command('search', async (ctx: any) => {
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);
  if (!connData) return ctx.reply('⚠️ <b>Connect via /start first.</b>', { parse_mode: 'HTML' });

  const query = ctx.message.text.replace('/search', '').trim();
  if (!query) return ctx.reply('🔍 Usage: <code>/search &lt;keyword&gt;</code>', { parse_mode: 'HTML' });

  try {
    const matches = await searchChannelVideos(connData.user.id, connData.channel.youtubeChannelId, query);
    if (matches.length === 0) return ctx.reply(`🔍 <b>No videos matching "${query}".</b>`, { parse_mode: 'HTML' });

    let text = `🔍 <b>Found ${matches.length} video(s) matching "${query}":</b>\n\n`;
    const numberRow: any[] = [];
    matches.forEach((v, i) => {
      text += `${i + 1}. <b>${v.title}</b> — Views: ${formatCount((v as any).viewCount || 0)}\n`;
      numberRow.push(Markup.button.callback(`🎬 ${i + 1}`, `vid_${v.id}`));
    });

    text += `\n<b>Tap a video number below to manage it:</b>`;
    await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard([numberRow]) });
  } catch (err: any) {
    await ctx.reply(`❌ <b>Search error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// ── Video Action Menu ─────────────────────────────────────────────────────────
bot.action(/^vid_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return ctx.reply('❌ <b>Video not found.</b>', { parse_mode: 'HTML' });

  const vAny = video as any;
  const text =
    `🎬 <b>${video.title}</b>\n\n` +
    `<b>Views:</b> ${formatCount(vAny.viewCount || 0)}\n` +
    `👍 <b>Likes:</b> ${formatCount(vAny.likeCount || 0)}\n` +
    `💬 <b>Comments:</b> ${formatCount(vAny.commentCount || 0)}\n\n` +
    `🏷️ <b>Tags:</b> ${video.tags.slice(0, 5).join(', ') || 'No tags'}\n\n` +
    `<b>Choose an action:</b>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Edit Title', `act_title_${video.id}`), Markup.button.callback('📝 Edit Description', `act_desc_${video.id}`)],
    [Markup.button.callback('🏷️ Edit Tags', `act_tags_${video.id}`), Markup.button.callback('🖼️ Update Thumbnail', `act_thumb_${video.id}`)],
    [Markup.button.callback('💬 View Comments', `act_comments_${video.id}`), Markup.button.callback('📌 Pinned Comment', `act_pincmt_${video.id}`)],
    [Markup.button.callback('🤖 AI Optimize', `act_ai_${video.id}`)],
  ]);

  if (video.thumbnailUrl) {
    try {
      await ctx.replyWithPhoto(video.thumbnailUrl, {
        caption: text,
        parse_mode: 'HTML',
        ...keyboard,
      });
      return;
    } catch (e) {
      // Fallback to text reply if photo fails
    }
  }

  await ctx.reply(text, {
    parse_mode: 'HTML',
    ...keyboard,
  });
});

// ── Edit Prompts ──────────────────────────────────────────────────────────────
bot.action(/^act_title_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;
  userStateMap.set(ctx.from.id.toString(), { action: 'AWAITING_TITLE', videoId: video.id, youtubeVideoId: video.youtubeVideoId });
  await ctx.reply(`✏️ <b>New title for:</b> "${video.title}"\n\nSend your new title:`, { parse_mode: 'HTML' });
});

bot.action(/^act_desc_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;
  userStateMap.set(ctx.from.id.toString(), { action: 'AWAITING_DESC', videoId: video.id, youtubeVideoId: video.youtubeVideoId });
  await ctx.reply(`📝 <b>New description for:</b> "${video.title}"\n\nSend your new description:`, { parse_mode: 'HTML' });
});

bot.action(/^act_tags_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;
  userStateMap.set(ctx.from.id.toString(), { action: 'AWAITING_TAGS', videoId: video.id, youtubeVideoId: video.youtubeVideoId });
  await ctx.reply(`🏷️ <b>New tags for:</b> "${video.title}"\n\nSend comma-separated tags:`, { parse_mode: 'HTML' });
});

bot.action(/^act_thumb_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;
  userStateMap.set(ctx.from.id.toString(), { action: 'AWAITING_THUMBNAIL', videoId: video.id, youtubeVideoId: video.youtubeVideoId });
  await ctx.reply(`🖼️ <b>Upload thumbnail for:</b> "${video.title}"\n\nSend a photo in this chat:`, { parse_mode: 'HTML' });
});

bot.action(/^act_pincmt_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;
  userStateMap.set(ctx.from.id.toString(), { action: 'AWAITING_PINNED_COMMENT', videoId: video.id, youtubeVideoId: video.youtubeVideoId });
  await ctx.reply(`📌 <b>Create & Pin Comment for:</b>\n"${video.title}"\n\nSend your comment text to post & pin on YouTube:`, { parse_mode: 'HTML' });
});

// ── Comments ──────────────────────────────────────────────────────────────────
bot.action(/^act_comments_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video || !connData) return;

  await ctx.reply('💬 <b>Fetching top comments...</b>', { parse_mode: 'HTML' });
  try {
    const comments = await fetchVideoComments(connData.user.id, video.youtubeVideoId, 5);
    if (comments.length === 0) return ctx.reply('💬 <b>No comments found on this video.</b>', { parse_mode: 'HTML' });

    for (const c of comments) {
      // Callback data must be <= 64 bytes for Telegram API (rc_<commentId>)
      const replyCallback = `rc_${c.commentId}`;
      const authorShort = c.authorName.length > 20 ? `${c.authorName.slice(0, 18)}..` : c.authorName;

      await ctx.reply(
        `👤 <b>${c.authorName}</b>:\n"${c.textDisplay}"`,
        {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([[Markup.button.callback(`↩️ Reply to ${authorShort}`, replyCallback)]]),
        }
      );
    }
  } catch (err: any) {
    await ctx.reply(`❌ <b>Failed to fetch comments:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

bot.action(/^rc_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const commentId = ctx.match[1];
  userStateMap.set(ctx.from.id.toString(), {
    action: 'AWAITING_COMMENT_REPLY',
    videoId: '',
    youtubeVideoId: '',
    extraData: { commentId },
  });
  await ctx.reply('✍️ <b>Type your reply to this comment:</b>', { parse_mode: 'HTML' });
});

// Store transient AI outputs: Key = `${type}_${videoId}`
const aiCacheMap = new Map<string, any>();

// ── AI Optimize Sub-Menu (6 Buttons) ──────────────────────────────────────────
bot.action(/^act_ai_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return ctx.reply('❌ <b>Video not found.</b>', { parse_mode: 'HTML' });

  const text =
    `🤖 <b>AI Optimization Suite for:</b>\n"${video.title}"\n\n` +
    `Select an AI optimization tool to generate and apply updates:`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('1. 🖼️ Generate New Thumbnail', `ais_thumb_${video.id}`)],
      [Markup.button.callback('2. ✏️ Generate New Title', `ais_title_${video.id}`)],
      [Markup.button.callback('3. 📝 Generate New Description', `ais_desc_${video.id}`)],
      [Markup.button.callback('4. 🏷️ Generate New Keywords/Tags', `ais_tags_${video.id}`)],
      [Markup.button.callback('5. 📌 Create Pinned Comment', `ais_pincmt_${video.id}`)],
      [Markup.button.callback('6. ↩️ Back to Video', `vid_${video.id}`)],
    ]),
  });
});

// 1. AI Generate Thumbnail
bot.action(/^ais_thumb_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;

  await ctx.sendChatAction('upload_photo');
  await ctx.reply('🤖 <b>Analyzing video title & generating high-CTR thumbnail...</b>\n<i>(Generating high-quality AI art... Please wait 15–25 seconds)</i>', { parse_mode: 'HTML' });

  try {
    const imageUrl = await generateAIThumbnail(video.title, video.thumbnailUrl || undefined);
    aiCacheMap.set(`thumb_${video.id}`, imageUrl);

    const caption = `🖼️ <b>AI Generated Thumbnail for:</b>\n"${video.title}"\n\nChoose an action below:`;
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Apply', `aia_thumb_${video.id}`),
        Markup.button.callback('🔄 Regenerate', `ais_thumb_${video.id}`),
      ],
      [
        Markup.button.callback('✏️ Custom Prompt / Ref', `aie_thumb_${video.id}`),
        Markup.button.callback('❌ Discard', `vid_${video.id}`),
      ],
    ]);

    if (imageUrl.startsWith('data:image')) {
      const base64Data = imageUrl.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: 'HTML', ...keyboard });
    } else {
      try {
        const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
        const buffer = Buffer.from(res.data);
        await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: 'HTML', ...keyboard });
      } catch (imgErr) {
        await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: 'HTML', ...keyboard });
      }
    }
  } catch (err: any) {
    await ctx.reply(`❌ <b>AI Thumbnail Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// Custom Prompt / Image Reference Thumbnail Guidance
bot.action(/^aie_thumb_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;

  userStateMap.set(ctx.from.id.toString(), {
    action: 'AWAITING_THUMB_CUSTOM',
    videoId: video.id,
    youtubeVideoId: video.youtubeVideoId,
  });

  const promptText =
    `✏️ <b>Custom AI Thumbnail Guidance for:</b>\n"${video.title}"\n\n` +
    `Reply with your custom instructions as a text message (e.g. <i>"Add bold neon yellow text saying EPIC WIN with dark blue fire background"</i>)\n\n` +
    `<b>OR</b> send an <b>image reference photo</b> in this chat that you want the AI to imitate as a visual guide!`;

  await ctx.reply(promptText, { parse_mode: 'HTML' });
});

// Apply AI Thumbnail
bot.action(/^aia_thumb_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  const imageUrl = aiCacheMap.get(`thumb_${ctx.match[1]}`);

  if (!connData || !video || !imageUrl) {
    return ctx.reply('❌ <b>Session expired. Please click Generate New Thumbnail again.</b>', { parse_mode: 'HTML' });
  }

  await ctx.reply('⏳ <b>Uploading AI thumbnail directly to YouTube...</b>', { parse_mode: 'HTML' });

  try {
    let buffer: Buffer;
    if (imageUrl.startsWith('data:image')) {
      const base64Data = imageUrl.split(',')[1];
      buffer = Buffer.from(base64Data, 'base64');
    } else {
      const res = await axios.get(imageUrl, { responseType: 'arraybuffer' });
      buffer = Buffer.from(res.data);
    }

    await updateVideoThumbnail(connData.user.id, video.youtubeVideoId, buffer, 'image/jpeg');
    aiCacheMap.delete(`thumb_${video.id}`);
    await ctx.reply(`✅ <b>AI Thumbnail Successfully Applied to YouTube!</b>`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🎬 Back to Video', `vid_${video.id}`)]]),
    });
  } catch (err: any) {
    await ctx.reply(`❌ <b>Failed to apply thumbnail:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// 2. AI Generate Titles
bot.action(/^ais_title_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;

  await ctx.reply('🤖 <b>Analyzing video & generating clickworthy viral titles...</b>', { parse_mode: 'HTML' });

  try {
    const result = await generateAITitles(video.title, video.description || '', video.tags);
    aiCacheMap.set(`titles_${video.id}`, result.titles);

    const text =
      `🤖 <b>AI Suggested Titles for:</b>\n"${video.title}"\n\n` +
      `1. <b>${result.titles[0]}</b>\n` +
      `2. <b>${result.titles[1]}</b>\n` +
      `3. <b>${result.titles[2]}</b>\n\n` +
      `💡 <i>${result.reasoning}</i>`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('✅ Apply Title 1', `aia_t0_${video.id}`)],
        [Markup.button.callback('✅ Apply Title 2', `aia_t1_${video.id}`)],
        [Markup.button.callback('✅ Apply Title 3', `aia_t2_${video.id}`)],
        [
          Markup.button.callback('🔄 Regenerate', `ais_title_${video.id}`),
          Markup.button.callback('❌ Discard', `vid_${video.id}`),
        ],
      ]),
    });
  } catch (err: any) {
    await ctx.reply(`❌ <b>AI Title Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// Apply AI Title
bot.action(/^aia_t(\d+)_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const titleIndex = parseInt(ctx.match[1], 10);
  const videoId = ctx.match[2];
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  const titles = aiCacheMap.get(`titles_${videoId}`);

  if (!connData || !video || !titles || !titles[titleIndex]) {
    return ctx.reply('❌ <b>Session expired. Please click Generate New Title again.</b>', { parse_mode: 'HTML' });
  }

  const selectedTitle = titles[titleIndex];
  try {
    const updated = await updateVideoTitle(connData.user.id, video.youtubeVideoId, selectedTitle);
    aiCacheMap.delete(`titles_${videoId}`);
    await ctx.reply(`✅ <b>YouTube Title Updated!</b>\n\n"${updated}"`, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([[Markup.button.callback('🎬 Back to Video', `vid_${video.id}`)]]),
    });
  } catch (err: any) {
    await ctx.reply(`❌ <b>Failed to update title:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// 3. AI Generate Description
bot.action(/^ais_desc_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;

  await ctx.reply('🤖 <b>Generating SEO-optimized description...</b>', { parse_mode: 'HTML' });

  try {
    const generatedDesc = await generateAIDescription(video.title, video.description || '');
    aiCacheMap.set(`desc_${video.id}`, generatedDesc);

    const text =
      `📝 <b>AI Generated Description for:</b>\n"${video.title}"\n\n` +
      `${generatedDesc}`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Apply', `aia_desc_${video.id}`),
          Markup.button.callback('🔄 Regenerate', `ais_desc_${video.id}`),
          Markup.button.callback('❌ Discard', `vid_${video.id}`),
        ],
      ]),
    });
  } catch (err: any) {
    await ctx.reply(`❌ <b>AI Description Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// Apply AI Description
bot.action(/^aia_desc_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const videoId = ctx.match[1];
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  const desc = aiCacheMap.get(`desc_${videoId}`);

  if (!connData || !video || !desc) {
    return ctx.reply('❌ <b>Session expired. Please click Generate New Description again.</b>', { parse_mode: 'HTML' });
  }

  try {
    await updateVideoDescription(connData.user.id, video.youtubeVideoId, desc);
    aiCacheMap.delete(`desc_${videoId}`);
    await ctx.reply(`✅ <b>YouTube Description Updated!</b>`, { parse_mode: 'HTML' });
  } catch (err: any) {
    await ctx.reply(`❌ <b>Failed to update description:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// 4. AI Generate Keywords / Tags
bot.action(/^ais_tags_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;

  await ctx.reply('🤖 <b>Generating trending SEO keywords & tags...</b>', { parse_mode: 'HTML' });

  try {
    const tags = await generateAITags(video.title, video.tags);
    aiCacheMap.set(`tags_${video.id}`, tags);

    const text =
      `🏷️ <b>AI Generated Tags for:</b>\n"${video.title}"\n\n` +
      `<code>${tags.join(', ')}</code>`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Apply', `aia_tags_${video.id}`),
          Markup.button.callback('🔄 Regenerate', `ais_tags_${video.id}`),
          Markup.button.callback('❌ Discard', `vid_${video.id}`),
        ],
      ]),
    });
  } catch (err: any) {
    await ctx.reply(`❌ <b>AI Tags Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// Apply AI Tags
bot.action(/^aia_tags_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const videoId = ctx.match[1];
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);
  const video = await prisma.video.findUnique({ where: { id: videoId } });
  const tags = aiCacheMap.get(`tags_${videoId}`);

  if (!connData || !video || !tags) {
    return ctx.reply('❌ <b>Session expired. Please click Generate New Tags again.</b>', { parse_mode: 'HTML' });
  }

  try {
    const updated = await updateVideoTags(connData.user.id, video.youtubeVideoId, tags);
    aiCacheMap.delete(`tags_${videoId}`);
    await ctx.reply(`✅ <b>YouTube Tags Updated!</b>\n\n${updated.join(', ')}`, { parse_mode: 'HTML' });
  } catch (err: any) {
    await ctx.reply(`❌ <b>Failed to update tags:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// 5. AI Generate Pinned Comment
bot.action(/^ais_pincmt_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;

  await ctx.reply('🤖 <b>Generating high-engagement Pinned Comment...</b>', { parse_mode: 'HTML' });

  try {
    const commentText = await generateAIPinnedComment(video.title, video.description || '');

    const text =
      `📌 <b>AI Suggested Pinned Comment for:</b>\n"${video.title}"\n\n` +
      `<code>${commentText}</code>\n\n` +
      `<i>Copy the text above and pin it under your video on YouTube!</i>`;

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback('🔄 Regenerate', `ais_pincmt_${video.id}`),
          Markup.button.callback('↩️ Back to Video', `vid_${video.id}`),
        ],
      ]),
    });
  } catch (err: any) {
    await ctx.reply(`❌ <b>AI Pinned Comment Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// ── Photo handler (Thumbnail upload & Reference Image Guidance) ───────────────
bot.on('photo', async (ctx: any) => {
  const telegramChatId = ctx.from.id.toString();
  const state = userStateMap.get(telegramChatId);
  if (!state) return;

  const connData = await getConnectedChannel(telegramChatId);
  if (!connData) return;

  if (state.action === 'AWAITING_THUMBNAIL') {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);
    await ctx.reply('⏳ <b>Uploading thumbnail to YouTube...</b>', { parse_mode: 'HTML' });

    try {
      const res = await axios.get(fileLink.href, { responseType: 'arraybuffer' });
      await updateVideoThumbnail(connData.user.id, state.youtubeVideoId, Buffer.from(res.data), 'image/jpeg');
      userStateMap.delete(telegramChatId);
      await ctx.reply('✅ <b>Thumbnail Updated!</b>', { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.reply(`❌ <b>Failed:</b> ${err.message}`, { parse_mode: 'HTML' });
    }
    return;
  }

  if (state.action === 'AWAITING_THUMB_CUSTOM') {
    const video = await prisma.video.findUnique({ where: { id: state.videoId } });
    if (!video) return;

    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const fileLink = await ctx.telegram.getFileLink(photo.file_id);

    userStateMap.delete(telegramChatId);

    await ctx.sendChatAction('upload_photo');
    await ctx.reply('🤖 <b>Analyzing reference photo & rendering custom AI thumbnail...</b>\n<i>(Please wait 15–25 seconds)</i>', { parse_mode: 'HTML' });

    try {
      const customInstruction = `Remaster visual layout and color palette inspired by user reference image (${fileLink.href})`;
      const imageUrl = await generateAIThumbnail(video.title, video.thumbnailUrl || undefined, customInstruction);
      aiCacheMap.set(`thumb_${video.id}`, imageUrl);

      const caption = `🖼️ <b>Custom AI Reference Thumbnail for:</b>\n"${video.title}"\n\nChoose an action below:`;
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Apply', `aia_thumb_${video.id}`),
          Markup.button.callback('🔄 Regenerate', `ais_thumb_${video.id}`),
        ],
        [
          Markup.button.callback('✏️ Custom Prompt / Ref', `aie_thumb_${video.id}`),
          Markup.button.callback('❌ Discard', `vid_${video.id}`),
        ],
      ]);

      if (imageUrl.startsWith('data:image')) {
        const base64Data = imageUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: 'HTML', ...keyboard });
      } else {
        try {
          const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
          const buffer = Buffer.from(res.data);
          await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: 'HTML', ...keyboard });
        } catch (imgErr) {
          await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: 'HTML', ...keyboard });
        }
      }
    } catch (err: any) {
      await ctx.reply(`❌ <b>Custom Thumbnail Error:</b> ${err.message}`, { parse_mode: 'HTML' });
    }
    return;
  }
});

// ── Text handler (edits, replies & custom thumbnail prompts) ──────────────────
bot.on('text', async (ctx: any) => {
  const telegramChatId = ctx.from.id.toString();
  const state = userStateMap.get(telegramChatId);
  if (!state) return;

  const text = ctx.message.text.trim();
  const connData = await getConnectedChannel(telegramChatId);
  if (!connData) return;

  try {
    if (state.action === 'AWAITING_TITLE') {
      const updated = await updateVideoTitle(connData.user.id, state.youtubeVideoId, text);
      userStateMap.delete(telegramChatId);
      await ctx.reply(`✅ <b>Title Updated!</b>\n\n"${updated}"`, { parse_mode: 'HTML' });
    } else if (state.action === 'AWAITING_DESC') {
      await updateVideoDescription(connData.user.id, state.youtubeVideoId, text);
      userStateMap.delete(telegramChatId);
      await ctx.reply('✅ <b>Description Updated!</b>', { parse_mode: 'HTML' });
    } else if (state.action === 'AWAITING_TAGS') {
      const tags = text.split(',').map((t: string) => t.trim()).filter(Boolean);
      const updated = await updateVideoTags(connData.user.id, state.youtubeVideoId, tags);
      userStateMap.delete(telegramChatId);
      await ctx.reply(`✅ <b>Tags Updated!</b>\n${updated.join(', ')}`, { parse_mode: 'HTML' });
    } else if (state.action === 'AWAITING_COMMENT_REPLY') {
      const commentId = state.extraData?.commentId;
      if (!commentId) return;
      await replyToComment(connData.user.id, commentId, text);
      userStateMap.delete(telegramChatId);
      await ctx.reply('✅ <b>Reply Posted!</b>', { parse_mode: 'HTML' });
    } else if (state.action === 'AWAITING_PINNED_COMMENT') {
      await ctx.reply('⏳ <b>Posting and pinning comment on YouTube...</b>', { parse_mode: 'HTML' });
      await postAndPinComment(connData.user.id, state.youtubeVideoId, text);
      userStateMap.delete(telegramChatId);
      await ctx.reply(`✅ <b>Comment Posted & Pinned on YouTube!</b>\n\n💬 "${text}"`, { parse_mode: 'HTML' });
    } else if (state.action === 'AWAITING_THUMB_CUSTOM') {
      const video = await prisma.video.findUnique({ where: { id: state.videoId } });
      if (!video) return;

      userStateMap.delete(telegramChatId);

      await ctx.sendChatAction('upload_photo');
      await ctx.reply('🤖 <b>Generating custom AI thumbnail based on your instructions...</b>\n<i>(Please wait 15–25 seconds)</i>', { parse_mode: 'HTML' });

      const imageUrl = await generateAIThumbnail(video.title, video.thumbnailUrl || undefined, text);
      aiCacheMap.set(`thumb_${video.id}`, imageUrl);

      const caption = `🖼️ <b>Custom AI Thumbnail for:</b>\n"${video.title}"\n<i>Instructions: "${text}"</i>\n\nChoose an action below:`;
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('✅ Apply', `aia_thumb_${video.id}`),
          Markup.button.callback('🔄 Regenerate', `ais_thumb_${video.id}`),
        ],
        [
          Markup.button.callback('✏️ Custom Prompt / Ref', `aie_thumb_${video.id}`),
          Markup.button.callback('❌ Discard', `vid_${video.id}`),
        ],
      ]);

      if (imageUrl.startsWith('data:image')) {
        const base64Data = imageUrl.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: 'HTML', ...keyboard });
      } else {
        try {
          const res = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 20000 });
          const buffer = Buffer.from(res.data);
          await ctx.replyWithPhoto({ source: buffer }, { caption, parse_mode: 'HTML', ...keyboard });
        } catch (imgErr) {
          await ctx.replyWithPhoto(imageUrl, { caption, parse_mode: 'HTML', ...keyboard });
        }
      }
    }
  } catch (err: any) {
    await ctx.reply(`❌ <b>Update Failed:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// ── Bot Launch ────────────────────────────────────────────────────────────────
export const initTelegramBot = async (publicUrl?: string, retries = 5): Promise<void> => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') {
    console.log('ℹ️ Telegram Bot skipped (TELEGRAM_BOT_TOKEN not set).');
    return;
  }

  // If running in production with HTTPS (e.g. Render), register Webhook
  if (publicUrl && publicUrl.startsWith('https://')) {
    const webhookUrl = `${publicUrl}/telegram/webhook`;
    try {
      await bot.telegram.setWebhook(webhookUrl);
      console.log(`🤖 Telegram Bot Webhook registered successfully: ${webhookUrl}`);
      return;
    } catch (err: any) {
      console.error(`❌ Could not set Telegram Webhook: ${err.message}`);
    }
  }

  // Fallback for local development: Long Polling
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  } catch (err: any) {
    console.warn('ℹ️ deleteWebhook info:', err.message);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await bot.launch();
      console.log('🤖 Telegram Bot launched with long polling!');
      return;
    } catch (err: any) {
      console.warn(`⚠️ Bot launch attempt ${attempt}/${retries}: ${err.message}`);
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 5000));
      } else {
        console.error('❌ Could not connect to Telegram API after retries.');
      }
    }
  }
};

