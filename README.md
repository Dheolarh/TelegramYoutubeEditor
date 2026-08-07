# 🤖 YouTube Channel AI Manager & Automation Telegram Bot

An all-in-one, personalized, self-hosted Telegram Bot that acts as an **AI Co-Pilot for YouTube Creators**. 

Manage your entire YouTube channel directly from Telegram—generate 4K thumbnails, optimize SEO metadata (titles, descriptions, tags), post & pin creator comments, automatically moderate profanity and spam, track real-time niche trends, and analyze channel performance analytics in real time.

---

## ✨ Features

- 📹 **Paginated Video Manager (`/videos`):** Browse and manage your YouTube channel's videos in interactive 10-video pages with live view, like, and comment stats. Tap any video to open its dedicated control menu for instant title, description, tag, thumbnail, comment, and AI optimization edits.
- 🖼️ **4K AI Thumbnail Generation & Remastering:** Remaster existing video thumbnails or generate high-CTR 16:9 cover art using **Pollinations FLUX.1** (Free, zero API key required) with optional **OpenAI DALL-E 3** or **Google Imagen 3** fallbacks. Includes reference image styling and text prompts.
- ✏️ **AI SEO Title, Description & Keyword Tag Suite:** Instantly generate viral, high-CTR titles, full timestamps-ready descriptions, and optimized YouTube tags tailored to your niche.
- 📌 **Create & Pin Comments:** Compose and pin top-level creator comments under any YouTube video directly inside Telegram.
- 🛡️ **Automated Comment Moderation (Background Cron):** Background cron job that periodically scans video comments and automatically deletes toxic profanity, hate speech, and spam links using `leo-profanity` + regex filtering.
- ⚡ **Live Mode Trend & Viewer Search Intent Scanner:** Automatically polls YouTube API for viral 48h niche trends and real-time viewer autocomplete search queries, generating an AI Market Intelligence Digest.
- 🎯 **Custom Niche Tracking (`/setniche`):** Set or override custom niche topics (e.g. `gaming, tech, football`) for targeted live trend scanning.
- 📊 **Channel Analytics Dashboard:** View 7-day, 30-day, or 90-day views, watch time, subscriber growth, and top-performing videos with AI performance insights.
- 💬 **Interactive Comment Manager:** Fetch top comments on recent videos and post creator replies directly from Telegram.
- 🔒 **Self-Hosted Personal Security Lock:** Restricted via `TELEGRAM_ALLOWED_CHAT_ID` so only your authorized Telegram account can control your YouTube channel.

---

## 🛠️ Technology Stack

- **Runtime & Framework:** Node.js, Express, TypeScript, Telegraf (Telegram Bot Framework)
- **Database & ORM:** Prisma ORM, PostgreSQL (Neon / Supabase)
- **APIs Integrated:** Google YouTube Data API v3, YouTube Analytics API, Google OAuth 2.0
- **AI Engines:** Pollinations FLUX.1, Google Gemini 2.5 Flash, OpenAI (GPT-4o-mini / DALL-E 3), DeepSeek AI

---

## 🚀 Step-by-Step Setup & Deployment Guide

Follow this guide to set up your Google Cloud API credentials, database, environment variables, and host the bot.

---

### Step 1: Create a Telegram Bot via BotFather

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the instructions to name your bot.
3. Copy your **Telegram Bot Token** (e.g., `7123456789:AAFg...`).
4. Find your personal Telegram Chat ID by chatting with `@userinfobot`. Copy your ID number (e.g., `123456789`).

---

### Step 2: Google Cloud Platform (GCP) Setup

To connect your YouTube channel, you need Google OAuth 2.0 credentials and enabled APIs in Google Cloud Console.

1. **Create a GCP Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com/).
   - Click **Select a project** > **New Project**, name it `YouTube Telegram Bot`, and click **Create**.

2. **Enable Required APIs:**
   - In the left sidebar, navigate to **APIs & Services** > **Library**.
   - Search for and **Enable** the following APIs:
     - **YouTube Data API v3**
     - **YouTube Analytics API**

3. **Configure OAuth Consent Screen:**
   - Navigate to **APIs & Services** > **OAuth consent screen**.
   - Select **User Type:** **External**, then click **Create**.
   - Fill in:
     - **App name:** `YouTube Telegram Bot`
     - **User support email:** Your email address
     - **Developer contact information:** Your email address
   - Click **Save and Continue**.
   - Under **Scopes**, click **Add or Remove Scopes** and select:
     - `.../auth/youtube.force-ssl`
     - `.../auth/youtube.readonly`
     - `.../auth/yt-analytics.readonly`
   - Under **Test users**, add your own Google email address (the account that owns your YouTube channel).

4. **Create OAuth 2.0 Credentials:**
   - Navigate to **APIs & Services** > **Credentials**.
   - Click **+ Create Credentials** > **OAuth client ID**.
   - Select **Application type:** **Web application**.
   - Name: `YouTube Bot Web Client`.
   - Under **Authorized redirect URIs**, add:
     - For local development: `http://localhost:3000/auth/google/callback`
     - For production: `https://<your-render-app-url>.onrender.com/auth/google/callback`
   - Click **Create**. Copy your **Client ID** and **Client Secret**.

---

### Step 3: Database Setup (Neon PostgreSQL / Supabase)

The bot requires a PostgreSQL database to store user connections, channel data, and video records.

1. Go to [Neon.tech](https://neon.tech/) (or Supabase).
2. Create a new free PostgreSQL database project named `yt-bot-db`.
3. Copy the **Pooled Connection String** (`DATABASE_URL`) and **Direct Connection String** (`DIRECT_URL`).

---

### Step 4: Environment Variables Setup (`.env`)

Clone the repository and copy the example environment file:

```bash
git clone https://github.com/Dheolarh/TelegramYoutubeEditor.git
cd TelegramYoutubeEditor
cp .env.example .env
```

Open `.env` and fill in your keys:

```env
PORT=3000

# Personal Security Lock (Your Telegram Chat ID from @userinfobot)
TELEGRAM_ALLOWED_CHAT_ID="123456789"

# Telegram Bot Token (from @BotFather)
TELEGRAM_BOT_TOKEN="your_telegram_bot_token_here"

# Database Connection (PostgreSQL - Neon / Supabase)
DATABASE_URL="postgresql://user:password@ep-xxxx.neon.tech/neondb?sslmode=require"

# Google OAuth Credentials (from GCP Console)
GOOGLE_CLIENT_ID="your_google_client_id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your_google_client_secret"
GOOGLE_REDIRECT_URI="https://<your-app-domain>.onrender.com/auth/google/callback"

# AI Provider Settings
AI_TEXT_PROVIDER="gemini"
GEMINI_MODEL="gemini-2.5-flash"
GEMINI_API_KEY="your_gemini_api_key_from_aistudio"

# Optional AI Providers (DALL-E 3 / DeepSeek)
OPENAI_API_KEY="sk-..." # Optional for DALL-E 3 thumbnail fallback
```

---

### Step 5: Local Installation & Database Push

Run the following commands to install dependencies, push database schema, and test locally:

```bash
# 1. Install dependencies
npm install

# 2. Push Prisma database schema to Neon/Supabase PostgreSQL
npx prisma db push

# 3. Generate Prisma Client
npx prisma generate

# 4. Start local development server
npm run dev
```

---

### Step 6: Free Hosting Deployment (Render.com)

You can easily host this bot 24/7 for free on **Render.com**:

1. Push your repository to GitHub.
2. Log in to [Render.com](https://render.com/) and click **New +** > **Web Service**.
3. Connect your GitHub repository `TelegramYoutubeEditor`.
4. Configure service settings:
   - **Environment:** `Node`
   - **Build Command:** `npm run build`
   - **Start Command:** `npm start`
5. Scroll down to **Environment Variables** and add all key-value pairs from your `.env` file.
6. Click **Create Web Service**.
7. Copy your deployed web service URL (e.g. `https://yt-bot.onrender.com`).
8. Go back to your **GCP Console** > **Credentials** > **OAuth Client ID**, and update **Authorized redirect URIs** to match your Render callback URL:
   `https://yt-bot.onrender.com/auth/google/callback`

---

## 🎮 Telegram Bot Commands Reference

| Command | Description |
| :--- | :--- |
| `/start` | Launch bot dashboard & connect your YouTube channel via Google OAuth. |
| `/videos` | Open paginated video manager (Title, Description, Tags, Thumbnail, Comments, Pinned Comments, AI Suite). |
| `/setniche [topics]` | Set or clear custom niche topics for trend tracking (e.g., `/setniche gaming, tech`). |
| `/livemode` | View status, toggle real-time trend polling, or trigger an instant trend scan. |
| `/moderation` | Toggle automated profanity/spam comment cleaner or trigger an instant comment scan. |
| `/analytics` | View channel views, watch time, subscribers (7d / 30d / 90d) with AI performance analysis. |
| `/help` | Display command quick reference & usage guides. |

---

## 📜 License

MIT License © 2026. Built for YouTube Creators.
