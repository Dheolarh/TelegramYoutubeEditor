import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initTelegramBot, bot } from './services/telegramBot';
import { authRouter } from './routes/auth';
import { runTrendAlertScanner } from './services/trendCron';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'Personal YouTube Telegram Bot API',
    timestamp: new Date().toISOString(),
  });
});

// Routes
app.use('/auth', authRouter);
app.get('/connect', (req, res) => {
  const uid = (req.query.uid as string) || (req.query.state as string) || '';
  res.redirect(`/auth/connect?uid=${uid}`);
});


// Start Server & Launch Telegram Bot
app.listen(PORT, async () => {
  const publicUrl =
    process.env.GOOGLE_REDIRECT_URI?.replace('/auth/google/callback', '') ||
    process.env.RENDER_EXTERNAL_URL ||
    `http://localhost:${PORT}`;

  console.log(`🚀 Server running on ${publicUrl}`);
  console.log(`🔗 Google OAuth Redirect URL: ${publicUrl}/auth/google/callback`);

  // Launch Telegram Bot Long Polling listener
  await initTelegramBot();

  // Schedule Proactive Trend Alert Scanner (Runs every 6 hours)
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(runTrendAlertScanner, SIX_HOURS);
});

// Graceful Shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
