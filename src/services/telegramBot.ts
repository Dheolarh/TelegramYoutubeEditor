import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import axios from 'axios';
import { authGuard } from '../middleware/authGuard';
import { prisma } from '../config/db';
import { fetchRecentVideos, searchChannelVideos } from './youtubeVideos';
import {
  updateVideoTitle,
  updateVideoDescription,
  updateVideoTags,
  updateVideoThumbnail,
  fetchVideoComments,
  replyToComment,
} from './youtubeEdit';
import { generateMetadataSuggestions } from './aiService';
import { getGoogleAuthUrl } from './youtubeAuth';


dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken || botToken === 'your_telegram_bot_token_here') {
  console.warn('⚠️ TELEGRAM_BOT_TOKEN is not set in .env.');
}

export const bot = new Telegraf(botToken || 'dummy_token_for_build');

bot.use(authGuard);

interface UserState {
  action: 'AWAITING_TITLE' | 'AWAITING_DESC' | 'AWAITING_TAGS' | 'AWAITING_THUMBNAIL' | 'AWAITING_COMMENT_REPLY';
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
    `• <b>/search &lt;keyword&gt;</b> - Search your videos by title\n` +
    `• <b>/help</b> - Show this help menu\n\n` +
    `<b>Available Video Features:</b>\n` +
    `✏️ Edit Titles, Descriptions &amp; Tags\n` +
    `🖼️ Upload Thumbnails by sending photos\n` +
    `💬 View &amp; Reply to top comments\n` +
    `🤖 AI-Powered Metadata Optimization (Gemini / DeepSeek)`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('📹 Browse Videos', 'cmd_videos')],
      [Markup.button.callback('🏠 Back to Start', 'cmd_start')],
    ]),
  });
};

bot.command('help', handleHelpCommand);
bot.action('cmd_help', async (ctx) => { await ctx.answerCbQuery(); await handleHelpCommand(ctx); });


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
      text += `${num}. <b>${v.title}</b>\n`;

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
      text += `${i + 1}. <b>${v.title}</b>\n`;
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

  const text =
    `🎬 <b>${video.title}</b>\n` +
    `🏷️ ${video.tags.slice(0, 5).join(', ') || 'No tags'}\n\n` +
    `<b>Choose an action:</b>`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('✏️ Edit Title', `act_title_${video.id}`), Markup.button.callback('📝 Edit Description', `act_desc_${video.id}`)],
    [Markup.button.callback('🏷️ Edit Tags', `act_tags_${video.id}`), Markup.button.callback('🖼️ Update Thumbnail', `act_thumb_${video.id}`)],
    [Markup.button.callback('💬 View Comments', `act_comments_${video.id}`), Markup.button.callback('🤖 AI Optimize', `act_ai_${video.id}`)],
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

// ── AI Optimize ───────────────────────────────────────────────────────────────
bot.action(/^act_ai_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const video = await prisma.video.findUnique({ where: { id: ctx.match[1] } });
  if (!video) return;

  const provider = (process.env.AI_TEXT_PROVIDER || 'gemini').toUpperCase();
  await ctx.reply(`🤖 <b>Running ${provider} AI Optimization...</b>`, { parse_mode: 'HTML' });

  try {
    const suggestions = await generateMetadataSuggestions(video.title, video.description || '', video.tags, 'Technology');

    const text =
      `🤖 <b>AI Suggestions for "${video.title}":</b>\n\n` +
      `💡 <b>Titles:</b>\n` +
      suggestions.titles.map((t, i) => `${i + 1}. "${t}"`).join('\n') +
      `\n\n🏷️ <b>Tags:</b>\n${suggestions.tags.join(', ')}\n\n` +
      `<b>Click to apply a title directly to YouTube:</b>`;

    userStateMap.set(ctx.from.id.toString(), {
      action: 'AWAITING_TITLE',
      videoId: video.id,
      youtubeVideoId: video.youtubeVideoId,
      extraData: { suggestions },
    });

    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...Markup.inlineKeyboard(suggestions.titles.map((_, i) => [
        Markup.button.callback(`✅ Apply Title ${i + 1}`, `apply_title_${video.id}_${i}`),
      ])),
    });
  } catch (err: any) {
    await ctx.reply(`❌ <b>AI Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

bot.action(/^apply_title_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);
  const state = userStateMap.get(telegramChatId);
  if (!connData || !state?.extraData?.suggestions) {
    return ctx.reply('❌ <b>State expired. Run AI Optimize again.</b>', { parse_mode: 'HTML' });
  }
  const selected = state.extraData.suggestions.titles[parseInt(ctx.match[2], 10)];
  if (!selected) return;

  try {
    const updated = await updateVideoTitle(connData.user.id, state.youtubeVideoId, selected);
    userStateMap.delete(telegramChatId);
    await ctx.reply(`✅ <b>Title Updated!</b>\n\n"${updated}"`, { parse_mode: 'HTML' });
  } catch (err: any) {
    await ctx.reply(`❌ <b>Failed:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

// ── Photo handler (Thumbnail upload) ─────────────────────────────────────────
bot.on('photo', async (ctx: any) => {
  const telegramChatId = ctx.from.id.toString();
  const state = userStateMap.get(telegramChatId);
  if (!state || state.action !== 'AWAITING_THUMBNAIL') return;

  const connData = await getConnectedChannel(telegramChatId);
  if (!connData) return;

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
});

// ── Text handler (edits & replies) ────────────────────────────────────────────
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

