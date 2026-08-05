import { Router, Request, Response } from 'express';
import { getGoogleAuthUrl, exchangeCodeForTokens } from '../services/youtubeAuth';
import { fetchChannelMetadata } from '../services/youtubeData';
import { prisma } from '../config/db';
import { bot } from '../services/telegramBot';

export const authRouter = Router();

/**
 * GET /auth/connect
 * Clean short URL for Telegram button. Accepts ?uid=<telegramChatId>
 */
authRouter.get('/connect', (req: Request, res: Response) => {
  const telegramChatId = (req.query.uid as string) || (req.query.state as string) || process.env.TELEGRAM_ALLOWED_CHAT_ID || '';
  const authUrl = getGoogleAuthUrl(telegramChatId);
  return res.redirect(authUrl);
});

/**
 * GET /auth/google
 * Initiates the Google OAuth authorization redirect.
 */
authRouter.get('/google', (req: Request, res: Response) => {
  const telegramChatId = (req.query.state as string) || (req.query.uid as string) || process.env.TELEGRAM_ALLOWED_CHAT_ID || '';
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
        userId: user.id,
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

    return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>YouTube Connected</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Inter', sans-serif;
      background: #0a0a0a;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .container {
      text-align: center;
      padding: 2rem;
      max-width: 360px;
      width: 100%;
    }

    .yt-icon {
      width: 48px;
      height: 48px;
      margin: 0 auto 2rem;
    }

    .checkmark {
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: #FF0000;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.5rem;
      animation: pop 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }

    @keyframes pop {
      0% { transform: scale(0); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }

    .checkmark svg {
      width: 24px;
      height: 24px;
      stroke: #fff;
      stroke-width: 2.5;
      fill: none;
      stroke-linecap: round;
      stroke-linejoin: round;
      stroke-dasharray: 40;
      stroke-dashoffset: 0;
      animation: draw 0.5s ease 0.3s both;
    }

    @keyframes draw {
      0% { stroke-dashoffset: 40; }
      100% { stroke-dashoffset: 0; }
    }

    h1 {
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 0.5rem;
      color: #fff;
    }

    .channel-name {
      color: #FF0000;
      font-weight: 500;
    }

    p {
      font-size: 0.85rem;
      color: #666;
      line-height: 1.6;
      margin-bottom: 2rem;
    }

    .divider {
      width: 32px;
      height: 1px;
      background: #1f1f1f;
      margin: 1.5rem auto;
    }

    .hint {
      font-size: 0.75rem;
      color: #333;
      letter-spacing: 0.02em;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">
      <svg viewBox="0 0 24 24">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
    </div>

    <h1>Channel Connected</h1>

    <div class="divider"></div>

    <p>
      <span class="channel-name">${channelData.title}</span><br>
      is now linked to your Telegram bot.
    </p>

    <p class="hint">You can close this tab</p>
  </div>
</body>
</html>`);

  } catch (error: any) {
    console.error('❌ OAuth Callback Error:', error.response?.data || error.message);
    return res.status(500).send(`
      <h1>❌ Connection Failed</h1>
      <p>Error processing Google OAuth authentication: ${error.message}</p>
    `);
  }
});
