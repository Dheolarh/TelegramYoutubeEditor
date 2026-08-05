# 🎬 YouTube Telegram Editor & AI Growth Assistant

An enterprise-grade, AI-powered Telegram bot designed to manage, analyze, edit, and optimize your YouTube channel directly from Telegram.

---

## 🌟 Key Feature Highlights

### 1. 🔐 OAuth 2.0 Integration & High-Performance Webhooks
- **One-Click Channel Connection:** Link your YouTube channel securely via Google OAuth 2.0 (`/start`).
- **Telegram Webhook Architecture:** Hosted on HTTPS (Render) for instant response times without polling delays.
- **Sleek YouTube Dark Theme:** Styled OAuth authorization success page with YouTube red (`#FF0000`) accents.

---

### 2. 📹 Video Listing & Search (`/videos`, `/search`)
- **10-Video Paginated Grid:** Lists your most recent uploads cleanly with formatted view counts (e.g. `Views: 73.2K`).
- **Quick Tap Grid Buttons:** `[ 🎬 1 ]` ... `[ 🎬 10 ]` for fast video selection.
- **Navigation Controls:** `[ ⬅️ Prev ]` and `[ ➡️ Next ]` page navigation.
- **Keyword Search:** Find any upload instantly by keyword (`/search <query>`).

---

### 3. ✏️ Video Metadata Editing & Photo Thumbnail Upload
- **Title Editing:** Update video titles in real-time.
- **Description & Tag Editing:** Update descriptions and comma-separated tags.
- **Photo Thumbnail Upload:** Send any photo directly in Telegram to set it as the YouTube thumbnail.
- **Direct Sync:** Instantly syncs changes with YouTube Data API v3 and local PostgreSQL database.

---

### 4. 💬 Comment Management & One-Tap Replies
- **Top Comments View:** Inspect recent viewer comments for any video.
- **One-Tap Reply Button:** `[ ↩️ Reply ]` buttons engineered under Telegram's 64-byte payload limit (`rc_<commentId>`).
- **Graceful Error Handling:** Handles `commentsDisabled` gracefully without crashing.

---

### 5. 🤖 Multi-Provider AI Optimization Suite
Access a 6-tool AI sub-menu by tapping **`🤖 AI Optimize`** on any video:
- **Fallback Engine:** OpenAI (DALL-E 3 / GPT-4o-mini) $\rightarrow$ Google Gemini (2.5 Flash) $\rightarrow$ DeepSeek (DeepSeek Chat) $\rightarrow$ Pollinations.
- **🖼️ Generate New Thumbnail:** High-CTR visual thumbnail art with `[ ✅ Apply ]`, `[ 🔄 Regenerate ]`, and `[ ❌ Discard ]`.
- **✏️ Generate New Title:** 3 clickworthy viral titles with CTR reasoning.
- **📝 Generate New Description:** SEO-friendly descriptions with hooks, bullet points, and CTAs.
- **🏷️ Generate New Keywords/Tags:** 15 high-volume ranking keywords.
- **📌 Create Pinned Comment:** Engagement-boosting community question.
- **📅 Dynamic Year Context:** System dynamically uses the active calendar year (never uses past years).

---

### 6. ⚡ Live Mode — YouTube Niche Trend Scanner (`/livemode`)
- **Real-Time YouTube Trend Discovery:** Polling of YouTube Data API (`search.list`) for viral videos in your niche.
- **YouTube Search Autocomplete Engine:** Queries `suggestqueries.google.com` to discover real search keywords typed by viewers right now.
- **AI Post Suggestion Cards:** Automatically generates complete Video Post Concepts (Title + Thumbnail + Description + Tags + Virality Reason).
- **Interactive Actions:** `[ 📌 Save Suggestion ]`, `[ 🔄 Regenerate ]`, `[ ❌ Dismiss ]`.

---

### 7. 🛡️ Automated Comment Moderation Engine (`/moderation`)
- **Profanity & Spam Cleaner:** Uses `leo-profanity` npm dictionary + link/crypto spam regex.
- **Automated YouTube Deletion:** Sends HTTP `DELETE` calls to YouTube Comments API to remove toxic comments permanently.
- **Telegram Notification Alerts:** Sends a summary report whenever profane comments are deleted in the background.
- **Rate Limit Safety:** Includes 200ms request delays to comply with Google API burst limits.

---

### 8. 📊 YouTube Analytics API v2 Dashboard (`/analytics`)
- **Official Reports:** Queries `youtubeanalytics.googleapis.com/v2/reports`.
- **📈 Performance Overview:** Views, Watch Time (Hours), Subscribers Gained, Likes, Comments.
- **🚦 Traffic Sources:** % breakdown of views from YouTube Search, Suggested Videos, External, Playlists.
- **👥 Audience Demographics:** Viewer age group percentages.
- **🎯 AI CTR & Growth Insight:** Actionable tips to turn search impressions into views.
- **Timeframe Switcher:** `[ 📈 Last 7 Days ]`, `[ 📊 Last 30 Days ]`, `[ 🗓️ Last 90 Days ]`.

---

### ⚙️ Command Summary

| Command | Description |
| :--- | :--- |
| `/start` | Welcome screen & OAuth channel connection |
| `/videos` | Browse & manage recent YouTube uploads |
| `/analytics` | Real-time channel performance & traffic sources |
| `/livemode` | Real-time YouTube niche trend polling & AI post ideas |
| `/moderation` | Automated profanity & toxic comment cleaner |
| `/search <query>` | Search channel uploads by keyword |
| `/help` | Complete help menu & feature list |

---

### 🛠️ Technology Stack
- **Backend:** Node.js, TypeScript, Express, Telegraf (Telegram Bot Framework)
- **Database:** PostgreSQL (Neon / Supabase), Prisma ORM
- **APIs:** YouTube Data API v3, YouTube Analytics API v2, Google OAuth 2.0
- **AI Engines:** OpenAI API (GPT-4o / DALL-E 3), Google Generative AI (Gemini 2.5 Flash), DeepSeek API, Pollinations AI
