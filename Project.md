# 🚀 YouTube Telegram Bot & AI Optimizer — Project Specification

## 📌 Project Overview
An AI-powered Telegram Bot designed for YouTube creators to manage, edit, and optimize their YouTube videos, comments, and metadata directly through Telegram using interactive inline buttons and slash commands.

---

## 🛠️ Tech Stack (100% Zero-Cost / Free Stack)

| Layer | Technology | Free Tier Details |
| :--- | :--- | :--- |
| **Runtime / Framework** | Node.js (TypeScript + `Telegraf` framework) | Server backend with Long Polling |
| **Primary Database** | PostgreSQL (Supabase / Neon) | Long-term data (Users, OAuth tokens, Videos) |
| **Messaging & Storage** | Telegram Bot API | 100% Free, handles image uploads directly via Telegram Servers |
| **Text AI Engine** | **Gemini** / **OpenAI** / **DeepSeek** | Configurable via `AI_TEXT_PROVIDER` (`gemini`, `openai`, `deepseek`) |
| **Image AI Engine** | **DALL-E 3** / **Banana / Gemini Nano** | Configurable via `AI_IMAGE_PROVIDER` (`openai`, `banana`) |
| **YouTube Integration** | YouTube Data API v3 & Analytics API | 10,000 free daily quota units |

---

## 🗄️ Database Schema Design

### `users`
* `id` (UUID, Primary Key)
* `telegram_chat_id` (VARCHAR, Unique) — Creator's Telegram Chat ID
* `created_at` (TIMESTAMP)

### `youtube_accounts`
* `id` (UUID, Primary Key)
* `user_id` (FK -> `users.id`)
* `channel_id` (VARCHAR)
* `access_token` (TEXT) — Encrypted Google OAuth access token
* `refresh_token` (TEXT) — Encrypted Google OAuth refresh token
* `expires_at` (TIMESTAMP)

### `channels`
* `id` (UUID, Primary Key)
* `user_id` (FK -> `users.id`)
* `youtube_channel_id` (VARCHAR, Unique)
* `title` (VARCHAR)
* `description` (TEXT)
* `subscriber_count` (INTEGER)

### `videos`
* `id` (UUID, Primary Key)
* `channel_id` (FK -> `channels.id`)
* `youtube_video_id` (VARCHAR, Unique)
* `title` (VARCHAR)
* `description` (TEXT)
* `tags` (ARRAY/TEXT)
* `thumbnail_url` (TEXT)
* `duration` (VARCHAR) — Used for Shorts vs Long-form classification ($\le 3 \text{ mins}$)
* `is_short` (BOOLEAN)
* `published_at` (TIMESTAMP)

### `comments`
* `id` (UUID, Primary Key)
* `video_id` (FK -> `videos.id`)
* `youtube_comment_id` (VARCHAR, Unique)
* `author_name` (VARCHAR)
* `text_display` (TEXT)
* `published_at` (TIMESTAMP)

---

## 🔄 Technical User Flows (Telegram UX)

### 1. User Registration & OAuth Flow
1. Creator sends `/start` or `/connect` to the Telegram Bot.
2. Bot generates a Google OAuth URL containing `state=telegram_chat_id`.
3. User opens the link, consents to YouTube permissions (`youtube.force-ssl`).
4. Google redirects to backend callback (`/auth/google/callback`).
5. Backend exchanges code for tokens, saves connection to `youtube_accounts`, and dispatches a Telegram message:
   > ✅ **Channel Connected:** *"Tech World"* (120 Videos)

---

### 2. Video Listing, Search & Selection Flow
Creators can browse videos via slash commands or text search:

#### Option A: Browse Recent Videos
1. Creator sends `/videos` or clicks `[ 📹 My Videos ]`.
2. Bot replies with an interactive list of recent videos + inline selection buttons:
   ```text
   📹 Your Recent Videos:
   1️⃣ AI Agents Explained
   2️⃣ Future of Robotics
   3️⃣ RTX 5090 Review
   
   [ 1️⃣ Select Video 1 ]  [ 2️⃣ Select Video 2 ]  [ 3️⃣ Select Video 3 ]
   ```

#### Option B: Keyword Search by Title
1. Creator sends `/search Robotics` or types `"Search Robotics"`.
2. Bot returns matching videos with inline buttons:
   ```text
   🔍 Search Results for "Robotics":
   1. Future of Robotics (2.4k views)
   2. Building a Bipedal Robot (1.1k views)
   
   [ 🎬 Select: Future of Robotics ]
   ```

---

### 3. Interactive Video Action Menu
Once a video is selected, Telegram displays **Inline Action Buttons**:
```text
🎬 Selected: "Future of Robotics"

Choose an action below:
[ ✏️ Edit Title ]       [ 📝 Edit Description ]
[ 🏷️ Edit Tags ]        [ 🖼️ Update Thumbnail ]
[ 💬 View Comments ]    [ 🤖 AI Optimize ]
```

---

### 4. Video Metadata Editing Flow
* **Edit Title**: User clicks `[ ✏️ Edit Title ]` -> Bot prompts: *"Send your new title for this video."* -> User types new title -> Bot shows preview with `[ ✅ Confirm ]` / `[ ❌ Cancel ]` buttons.
* **Edit Description**: Click `[ 📝 Edit Description ]` -> User inputs text.
* **Edit Tags**: Click `[ 🏷️ Edit Tags ]` -> User inputs comma-separated tags.
* **Update Thumbnail**: Click `[ 🖼️ Update Thumbnail ]` -> User uploads photo directly in Telegram -> Uploaded to **Cloudinary** -> Calls `thumbnails.set`.

---

### 5. Comment Management & Reply Flow
1. Creator clicks `[ 💬 View Comments ]`.
2. Bot lists top comments with reply buttons:
   ```text
   💬 Top Comments:
   • @alex: "Can you make a tutorial?"
     [ ↩️ Reply to @alex ]
   
   • @sam: "What tools did you use?"
     [ ↩️ Reply to @sam ]
   ```
3. Creator clicks `[ ↩️ Reply to @alex ]` -> Types reply -> Posted to YouTube (`comments.insert`).

---

### 6. AI Metadata Optimization Flow
1. Creator clicks `[ 🤖 AI Optimize ]`.
2. Backend passes current metadata to **Google Gemini API**.
3. Bot renders AI suggestions with inline 1-click apply button:
   ```text
   🤖 AI Optimization Suggestions:
   
   Suggested Title: "The Future of AI Agents: 2026 Guide"
   Suggested Tags: AI automation, AI tools, future tech
   
   [ ✅ Apply AI Suggestions ]   [ ❌ Cancel ]
   ```

---

### 7. Background Trend Scanner & Alerts (Cron Job)
* Background job runs every 6 hours:
  1. Scans trending topics in creator's niche.
  2. Cross-references older videos in database.
  3. Sends Telegram alert message with direct action button:
     > 🔥 **Trend Alert!**  
     > *"AI Agents"* are trending right now.  
     > Your older video *"Introduction to AI Agents"* could gain more views.  
     >  
     > `[ ⚡ Auto-Optimize Video ]`

---

## 🗓️ Project Implementation Phases (Roadmap)

### 🚩 Phase 1: Infrastructure & Database Setup (COMPLETED)
* [x] Initialize Node.js TypeScript project.
* [x] Connect **PostgreSQL** database & Prisma schema (`users`, `youtube_accounts`, `channels`, `videos`, `comments`).

---

### 🔑 Phase 2: Onboarding & Google OAuth Authentication (COMPLETED)
* [x] Initialize Telegram Bot using `Telegraf` framework & BotFather Token.
* [x] Build Google OAuth 2.0 authorization route (`/auth/google`) and callback handling.
* [x] Store encrypted `access_token` and `refresh_token` in `youtube_accounts`.
* [x] Sync channel metadata (`channels.list`) and send Telegram welcome notification.

---

### 🔍 Phase 3: Video Browsing, Search & Inline Keyboard UI (COMPLETED)
* [x] Build `/videos` recent video listing with inline callback buttons.
* [x] Build `/search <keyword>` video search feature.
* [x] Implement Interactive Action Menu with Telegram inline keyboard buttons.

---

### 📝 Phase 4: Video Editing, Thumbnails & Comment Replies (COMPLETED)
* [x] Implement Title, Description, and Tags update handlers with Telegram inline confirmations.
* [x] Direct Telegram photo stream downloading for thumbnail uploads (`thumbnails.set`).
* [x] Implement Comment listing & 1-click comment reply handlers.

---

### 🤖 Phase 5: Multi-AI Optimization & Trend Alerts (COMPLETED)
* [x] Integrate **Gemini**, **OpenAI**, and **DeepSeek** text engines + **Google Imagen 3** & **DALL-E 3** image engines.
* [x] Build 1-click inline button application for AI suggestions.
* [x] Build background Cron Job for trend detection and Telegram push alerts.

---

### 🎨 Phase 6: Testing & Demo Preparation (COMPLETED)
* [x] End-to-end testing of creator flows.
* [x] Full TypeScript compilation build verification (0 errors).
