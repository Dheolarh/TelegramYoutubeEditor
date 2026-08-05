import { Router, Request, Response } from 'express';
import { getGoogleAuthUrl, exchangeCodeForTokens } from '../services/youtubeAuth';
import { fetchChannelMetadata } from '../services/youtubeData';
import { prisma } from '../config/db';
import { bot } from '../services/telegramBot';

export const authRouter = Router();

/**
 * GET /auth/google
 * Initiates the Google OAuth authorization redirect.
 */
authRouter.get('/google', (req: Request, res: Response) => {
  const telegramChatId = (req.query.state as string) || process.env.TELEGRAM_ALLOWED_CHAT_ID || '';
  const authUrl = getGoogleAuthUrl(telegramChatId);
  return res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 * Google OAuth 2.0 callback route.
 */
authRouter.get('/google/callback', async (req: Request, res: Response) => {
  const code = req.query.code as string;
  const telegramChatId = (req.query.state as string) || process.env.TELEGRAM_ALLOWED_CHAT_ID || '';

  if (!code) {
    return res.status(400).send('<h1>❌ Authorization Code Missing</h1>');
  }

  try {
    // 1. Exchange OAuth code for Access & Refresh tokens
    const tokens = await exchangeCodeForTokens(code);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // 2. Fetch Channel Metadata from YouTube API
    const channelData = await fetchChannelMetadata(tokens.accessToken);

    // 3. Upsert User record in PostgreSQL
    const user = await prisma.user.upsert({
      where: { telegramChatId },
      update: {},
      create: { telegramChatId },
    });

    // 4. Upsert YouTubeAccount tokens
    const existingYtAcc = await prisma.youTubeAccount.findFirst({
      where: { userId: user.id, channelId: channelData.id },
    });

    if (existingYtAcc) {
      await prisma.youTubeAccount.update({
        where: { id: existingYtAcc.id },
        data: {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || existingYtAcc.refreshToken,
          expiresAt,
        },
      });
    } else {
      await prisma.youTubeAccount.create({
        data: {
          userId: user.id,
          channelId: channelData.id,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken || '',
          expiresAt,
        },
      });
    }

    // 5. Upsert Channel record
    await prisma.channel.upsert({
      where: { youtubeChannelId: channelData.id },
      update: {
        title: channelData.title,
        description: channelData.description,
        subscriberCount: channelData.subscriberCount,
      },
      create: {
        userId: user.id,
        youtubeChannelId: channelData.id,
        title: channelData.title,
        description: channelData.description,
        subscriberCount: channelData.subscriberCount,
      },
    });

    // 6. Send Telegram Notification to the Owner
    if (telegramChatId) {
      try {
        await bot.telegram.sendMessage(
          telegramChatId,
          `✅ *YouTube Channel Successfully Connected!*\n\n` +
            `📺 *Channel:* ${channelData.title}\n` +
            `👥 *Subscribers:* ${channelData.subscriberCount.toLocaleString()}\n\n` +
            `You can now manage and AI-optimize your videos directly from Telegram using /videos or /search!`,
          { parse_mode: 'Markdown' }
        );
      } catch (tgErr: any) {
        console.warn('⚠️ Could not send Telegram confirmation message:', tgErr.message);
      }
    }

    // 7. Render Browser Success Page
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>YouTube Connected</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc; text-align: center; }
          .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); max-width: 400px; }
          h1 { color: #22c55e; margin-bottom: 0.5rem; }
          p { color: #94a3b8; line-height: 1.5; }
          .badge { background: #334155; padding: 0.5rem 1rem; border-radius: 0.5rem; display: inline-block; margin-top: 1rem; font-weight: bold; color: #38bdf8; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✅ Channel Connected!</h1>
          <p>Your YouTube account <strong>${channelData.title}</strong> is now connected to your personal Telegram bot.</p>
          <div class="badge">You can close this tab and return to Telegram</div>
        </div>
      </body>
      </html>
    `);
  } catch (error: any) {
    console.error('❌ OAuth Callback Error:', error.response?.data || error.message);
    return res.status(500).send(`
      <h1>❌ Connection Failed</h1>
      <p>Error processing Google OAuth authentication: ${error.message}</p>
    `);
  }
});
