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
bot.command('start', async (ctx) => {
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
        [Markup.button.url('🔗 Re-Connect YouTube Channel', connectUrl)],
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
      ]),
    });
  }
});


// ── /help ─────────────────────────────────────────────────────────────────────
bot.command('help', async (ctx) => {
  await ctx.reply(
    `🤖 <b>Personal YouTube Bot Help</b>\n\n` +
      `• /start - Welcome &amp; Channel Status\n` +
      `• /videos - Browse your recent uploaded videos\n` +
      `• /search &lt;keyword&gt; - Search your videos by title\n` +
      `• /help - Show available commands`,
    { parse_mode: 'HTML' }
  );
});

// ── /videos ───────────────────────────────────────────────────────────────────
const handleVideosCommand = async (ctx: any) => {
  const telegramChatId = ctx.from.id.toString();
  const connData = await getConnectedChannel(telegramChatId);

  if (!connData) {
    return ctx.reply(
      '⚠️ <b>No YouTube channel connected yet.</b>\n\nConnect via /start.',
      { parse_mode: 'HTML' }
    );
  }

  await ctx.reply('⏳ <b>Fetching your recent videos...</b>', { parse_mode: 'HTML' });

  try {
    const videos = await fetchRecentVideos(connData.user.id, connData.channel.youtubeChannelId, 5);
    if (videos.length === 0) {
      return ctx.reply('📹 <b>No videos found.</b>', { parse_mode: 'HTML' });
    }

    let text = `📹 <b>Your Recent YouTube Videos:</b>\n\n`;
    const buttons: any[] = [];

    videos.forEach((v, i) => {
      text += `${i + 1}. <b>${v.title}</b> (${v.isShort ? '⚡ Short' : '🎥 Video'})\n`;
      buttons.push([Markup.button.callback(`🎬 ${i + 1}. ${v.title.slice(0, 30)}`, `vid_${v.id}`)]);
    });

    text += `\n<b>Tap a video below to manage it:</b>`;
    await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
  } catch (err: any) {
    await ctx.reply(`❌ <b>Error:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
};

bot.command('videos', handleVideosCommand);
bot.action('cmd_videos', async (ctx) => { await ctx.answerCbQuery(); await handleVideosCommand(ctx); });

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
    const buttons: any[] = [];
    matches.forEach((v, i) => {
      text += `${i + 1}. <b>${v.title}</b>\n`;
      buttons.push([Markup.button.callback(`🎬 ${i + 1}. ${v.title.slice(0, 30)}`, `vid_${v.id}`)]);
    });

    await ctx.reply(text, { parse_mode: 'HTML', ...Markup.inlineKeyboard(buttons) });
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
    `📌 ${video.isShort ? '⚡ Shorts' : '🎥 Standard'}\n` +
    `🏷️ ${video.tags.slice(0, 5).join(', ') || 'No tags'}\n\n` +
    `<b>Choose an action:</b>`;

  await ctx.reply(text, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [Markup.button.callback('✏️ Edit Title', `act_title_${video.id}`), Markup.button.callback('📝 Edit Description', `act_desc_${video.id}`)],
      [Markup.button.callback('🏷️ Edit Tags', `act_tags_${video.id}`), Markup.button.callback('🖼️ Update Thumbnail', `act_thumb_${video.id}`)],
      [Markup.button.callback('💬 View Comments', `act_comments_${video.id}`), Markup.button.callback('🤖 AI Optimize', `act_ai_${video.id}`)],
    ]),
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
    if (comments.length === 0) return ctx.reply('💬 <b>No comments found.</b>', { parse_mode: 'HTML' });

    for (const c of comments) {
      await ctx.reply(
        `👤 <b>${c.authorName}</b>:\n"${c.textDisplay}"`,
        { parse_mode: 'HTML', ...Markup.inlineKeyboard([[Markup.button.callback(`↩️ Reply to ${c.authorName}`, `reply_cmt_${c.commentId}_${video.id}`)]]) }
      );
    }
  } catch (err: any) {
    await ctx.reply(`❌ <b>Failed:</b> ${err.message}`, { parse_mode: 'HTML' });
  }
});

bot.action(/^reply_cmt_(.+)_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  userStateMap.set(ctx.from.id.toString(), {
    action: 'AWAITING_COMMENT_REPLY',
    videoId: ctx.match[2],
    youtubeVideoId: '',
    extraData: { commentId: ctx.match[1] },
  });
  await ctx.reply('✍️ <b>Send your reply:</b>', { parse_mode: 'HTML' });
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
export const initTelegramBot = async (retries = 5): Promise<void> => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') {
    console.log('ℹ️ Telegram Bot skipped (TELEGRAM_BOT_TOKEN not set).');
    return;
  }

  // Clear any existing webhooks to prevent 409 Conflict
  try {
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
  } catch (err: any) {
    console.warn('ℹ️ deleteWebhook info:', err.message);
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await bot.launch();
      console.log('🤖 Telegram Bot launched successfully!');
      return;
    } catch (err: any) {
      console.warn(`⚠️ Bot launch attempt ${attempt}/${retries}: ${err.message}`);
      if (attempt < retries) {
        // Wait 5 seconds for previous Render container instance to shutdown
        await new Promise((r) => setTimeout(r, 5000));
      } else {
        console.error('❌ Could not connect to Telegram API after retries.');
      }
    }
  }
};

