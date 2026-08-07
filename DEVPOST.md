# YouTube Channel AI Manager & Automation Telegram Bot

## Tagline
An all-in-one, self-hosted AI Telegram Bot that acts as an intelligent co-pilot for YouTube creators, handling 4K thumbnail generation, SEO metadata optimization, automated comment moderation, real-time trend intelligence, and analytics directly inside Telegram.

## Inspiration
Managing a YouTube channel requires juggling multiple complex tasks: designing high-CTR thumbnails, writing SEO-optimized titles and tags, moderating comment sections for spam and profanity, and staying on top of breaking trends. For solo creators, switching between YouTube Studio, design tools, and analytics dashboards takes valuable time away from content creation.

We built YouTube Channel AI Manager to condense the entire creator workflow into a single, intuitive Telegram messaging interface that automates channel operations using modern AI.

## What It Does
The project is a personalized, self-hosted Telegram bot connected directly to a creator's YouTube channel via Google OAuth 2.0. From Telegram, creators can:

1. **Manage Videos with Interactive Menus:** Browse paginated video lists (`/videos`) showing live views, likes, and comment counts, and edit metadata on the fly.
2. **Generate & Remaster 4K AI Thumbnails:** Create 16:9 gaming and tech thumbnails using FLUX.1 (or DALL-E 3 / Google Imagen 3), remaster existing covers, or generate customized thumbnails from text prompts and reference photos.
3. **Optimize SEO Metadata:** Instantly generate click-worthy titles, full timestamped descriptions, and high-volume YouTube tags powered by Google Gemini AI.
4. **Post & Pin Creator Comments:** Write, post, and pin top-level creator comments under any video directly from chat.
5. **Automate Comment Moderation:** A background cron job periodically scans video comments and automatically deletes toxic profanity, hate speech, and spam links (`/moderation`).
6. **Live Mode Trend & Search Intent Digest (`/setniche`):** Automatically polls YouTube API for viral 48-hour trends and real-time viewer autocomplete search queries in specified creator niches, delivering actionable video concepts.
7. **Analyze Channel Performance (`/analytics`):** View 7-day, 30-day, or 90-day views, watch time, subscriber growth, and AI-generated channel performance insights.

## How It Works

- **Bot Interface:** Built with Node.js, TypeScript, and Telegraf to handle interactive Telegram inline keyboards, callbacks, and photo uploads.
- **YouTube Integration:** Connects securely via Google OAuth 2.0, interacting directly with the YouTube Data API v3 and YouTube Analytics API to manage videos, comments, thumbnails, and channel stats.
- **AI Engine Pipeline:** 
  - **Text AI:** Utilizes Google Gemini 2.5 Flash (with OpenAI and DeepSeek fallbacks) to sanitize user prompts, craft visual instructions, generate SEO tags, and analyze channel metrics.
  - **Image AI:** Employs Pollinations FLUX.1 with custom prompt engineering to generate 4K 16:9 YouTube cover art.
- **Data Persistence & Security:** Uses Prisma ORM with Neon PostgreSQL to store user OAuth tokens, channel settings, custom niches, and video caches, protected by an environment-based Telegram Chat ID security lock (`TELEGRAM_ALLOWED_CHAT_ID`).

## Built With
`TypeScript`, `Node.js`, `Express`, `Telegraf`, `Prisma ORM`, `PostgreSQL (Neon)`, `Google YouTube Data API v3`, `YouTube Analytics API`, `Google Gemini AI`, `FLUX.1`, `OpenAI DALL-E 3`
