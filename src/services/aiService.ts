import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import axios from 'axios';

export interface AITitleResult {
  titles: string[];
  reasoning: string;
}

/**
 * Text AI Fallback Execution Engine.
 * Chain: OpenAI -> Gemini -> DeepSeek.
 */
const runTextAIWithFallback = async (prompt: string): Promise<string> => {
  const errors: string[] = [];

  // 1. Try OpenAI if API key available
  if (process.env.OPENAI_API_KEY) {
    try {
      const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (text) {
        console.log(`✅ Text AI generated using OpenAI (${model})`);
        return text;
      }
    } catch (err: any) {
      console.warn(`⚠️ OpenAI Text AI failed: ${err.message}. Trying Gemini fallback...`);
      errors.push(`OpenAI: ${err.message}`);
    }
  }

  // 2. Try Gemini if API key available
  if (process.env.GEMINI_API_KEY) {
    const modelsToTry = [
      process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro',
      'gemini-2.0-flash',
    ];

    for (const geminiModel of modelsToTry) {
      try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: geminiModel });
        const result = await model.generateContent(prompt);
        const text = result.response.text().replace(/```json|```/g, '').trim();
        if (text) {
          console.log(`✅ Text AI generated using Gemini (${geminiModel})`);
          return text;
        }
      } catch (err: any) {
        console.warn(`⚠️ Gemini (${geminiModel}) failed: ${err.message}`);
        errors.push(`Gemini (${geminiModel}): ${err.message}`);
      }
    }
  }

  // 3. Try DeepSeek if API key available
  if (process.env.DEEPSEEK_API_KEY) {
    try {
      const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
      const deepseek = new OpenAI({
        baseURL: 'https://api.deepseek.com',
        apiKey: process.env.DEEPSEEK_API_KEY,
      });
      const completion = await deepseek.chat.completions.create({
        model,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (text) {
        console.log(`✅ Text AI generated using DeepSeek (${model})`);
        return text;
      }
    } catch (err: any) {
      console.warn(`⚠️ DeepSeek Text AI failed: ${err.message}`);
      errors.push(`DeepSeek: ${err.message}`);
    }
  }

  throw new Error(`All AI Providers failed: ${errors.join(' | ')}`);
};

/**
 * Fetch real-time live trends specific to the video's topic/title.
 */
export const fetchLiveTrends = async (topicQuery?: string): Promise<string[]> => {
  if (topicQuery) {
    try {
      // Clean query to 2-3 core words for optimal search trend matching
      const cleanTopic = topicQuery.replace(/[^\w\s]/gi, '').split(' ').slice(0, 3).join(' ');
      const res = await axios.get(
        `https://news.google.com/rss/search?q=${encodeURIComponent(cleanTopic)}&hl=en-US&gl=US&ceid=US:en`,
        { timeout: 3500 }
      );
      const matches = [...res.data.matchAll(/<title>(.*?)<\/title>/g)]
        .map(m => m[1].replace(/ - .*/, '').trim())
        .filter(t => t && !t.includes('Google News'));

      if (matches.length > 0) {
        console.log(`📡 Fetched ${matches.length} live topic trends for "${cleanTopic}"`);
        return matches.slice(0, 8);
      }
    } catch (e) {
      // Fallback to general daily search trends
    }
  }

  try {
    const res = await axios.get('https://trends.google.com/trends/trendingsearches/daily/rss?geo=US', { timeout: 3000 });
    const matches = [...res.data.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]).filter(t => t && t !== 'Daily Search Trends');
    return matches.slice(0, 8);
  } catch (e) {
    const yr = new Date().getFullYear();
    return [`latest updates ${yr}`, 'how to fixed', 'best guide', 'new patch release', 'trending topic'];
  }
};

/**
 * 1. Generate Clickworthy Trending Titles
 */
export const generateAITitles = async (
  currentTitle: string,
  description: string,
  tags: string[]
): Promise<AITitleResult> => {
  const liveTrends = await fetchLiveTrends(currentTitle);
  const yr = new Date().getFullYear();

  const prompt = `You are a YouTube SEO and viral title expert.
CRITICAL SYSTEM CONTEXT: The current calendar year is dynamically evaluated as ${yr}. Always use the active current year (which is ${yr}) and NEVER use past years for any year references!

Analyze the video details and current live search trends specifically for this video topic below to generate 3 clickworthy, high-CTR titles.

Current Title: "${currentTitle}"
Description snippet: "${description.slice(0, 300)}"
Tags: ${JSON.stringify(tags)}
Live Search Trends Specific To This Topic Right Now: ${JSON.stringify(liveTrends)}

Incorporate these topic-specific trending viral angles (e.g. ${yr} updates, fixes, secrets, or active user search queries) if relevant to boost clickability.

Respond STRICTLY in JSON format:
{
  "titles": ["Viral Title 1", "Clickworthy Title 2", "SEO Title 3"],
  "reasoning": "Short explanation of why these titles match current search trends..."
}`;

  const rawJson = await runTextAIWithFallback(prompt);
  try {
    const parsed = JSON.parse(rawJson.replace(/```json|```/g, '').trim());
    return {
      titles: parsed.titles || [currentTitle],
      reasoning: parsed.reasoning || 'Optimized for high CTR and search relevance.',
    };
  } catch (err) {
    return {
      titles: [`🔥 ${currentTitle} (${yr} UPDATE)`, `HOW TO: ${currentTitle}`, `BEST GUIDE: ${currentTitle}`],
      reasoning: 'Generated trend-optimized titles.',
    };
  }
};

/**
 * 2. Generate SEO-Optimized Description
 */
export const generateAIDescription = async (
  currentTitle: string,
  currentDescription: string
): Promise<string> => {
  const prompt = `You are a YouTube growth expert.
Generate a high-converting, SEO-friendly YouTube video description for:

Video Title: "${currentTitle}"
Current Description: "${currentDescription.slice(0, 500)}"

Include:
- 2-sentence hook engaging the viewer
- Key topics covered in bullet points
- Call to action (Subscribe, Like, Comment)
- Relevant viral hashtags at the bottom

Respond with ONLY the raw description text. Do NOT wrap in JSON.`;

  return await runTextAIWithFallback(prompt);
};

/**
 * 3. Generate Trending SEO Keywords / Tags
 */
export const generateAITags = async (
  currentTitle: string,
  currentTags: string[]
): Promise<string[]> => {
  const prompt = `You are a YouTube SEO keyword expert.
Generate 15 high-volume, trending tags for the video titled "${currentTitle}".

Existing tags: ${JSON.stringify(currentTags)}

Respond STRICTLY in JSON format:
{
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11", "tag12", "tag13", "tag14", "tag15"]
}`;

  const rawJson = await runTextAIWithFallback(prompt);
  try {
    const parsed = JSON.parse(rawJson.replace(/```json|```/g, '').trim());
    return parsed.tags || currentTags;
  } catch (err) {
    return currentTags;
  }
};

/**
 * 4. Generate High-Engagement Pinned Comment
 */
export const generateAIPinnedComment = async (
  title: string,
  description: string
): Promise<string> => {
  const prompt = `You are a YouTube community manager.
Generate an engaging, discussion-starting Pinned Comment for the channel owner to pin under their video titled "${title}".

Include an open question asking viewers for their opinion to boost comments and engagement. Keep it under 200 characters with friendly emojis.

Respond with ONLY the comment text.`;

  return await runTextAIWithFallback(prompt);
};

const withTimeout = <T>(promise: Promise<T>, ms: number, fallbackMessage: string): Promise<T> => {
  let timeoutId: NodeJS.Timeout;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${fallbackMessage}`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

/**
 * 5. Generate AI Thumbnail (Fallback: OpenAI DALL-E 3 -> Imagen 3 -> Pollinations)
 * Analyzes video title & existing thumbnail context to generate an updated visual.
 */
export const generateAIThumbnail = async (
  title: string,
  currentThumbnailUrl?: string,
  customInstructions?: string
): Promise<string> => {
  // Step 1: Use Text AI to create a clean, hyper-focused image generation prompt
  const isUpgrade = Boolean(currentThumbnailUrl && currentThumbnailUrl.startsWith('http'));

  const promptAnalysis = `You are a professional YouTube Thumbnail Creative Director.
Video Title: "${title}"
${isUpgrade ? `Existing Thumbnail URL: ${currentThumbnailUrl}` : ''}
${customInstructions ? `User Requested Edit: "${customInstructions}"` : ''}

TASK: Convert the title, existing thumbnail context, and requested edit into a crisp, ultra-specific AI image prompt for a 16:9 YouTube thumbnail.

CRITICAL RULES:
${
  isUpgrade && !customInstructions
    ? `- THUMBNAIL REMASTER & PROP ADAPTATION RULE: The video has an existing thumbnail ("${currentThumbnailUrl}"). Preserve the core subject/theme while DYNAMICALLY UPDATING background props, text overlays, season badges, jersey kits, and thematic elements to perfectly fit the title ("${title}")! Upgrade 3D contrast, saturation, and 4k focal clarity.`
    : `- Focus 100% on the core subject specified by the user or video title.`
}
- Strip out conversational phrases like "Change the picture to", "Can you make", "Make it look like".
- If a sports, gaming, tech, or specific personality subject is requested, explicitly detail that specific character, game, or scene.
- ABSOLUTELY NO generic female portraits or unrelated faces unless explicitly requested by name.
- Keep the prompt under 45 words focusing on: Subject, Visual Style, Lighting, and 16:9 Aspect Ratio.

Respond with ONLY the raw image generation prompt string (no markdown, no quotes).`;

  let cleanImagePrompt = '';
  try {
    cleanImagePrompt = await withTimeout(runTextAIWithFallback(promptAnalysis), 6000, 'Visual prompt timeout');
  } catch (err) {
    cleanImagePrompt = customInstructions
      ? `${title}, ${customInstructions}, 3D gaming cover art, 16:9 YouTube thumbnail`
      : isUpgrade
      ? `Remastered upgraded version of existing ${title} thumbnail, high contrast 3D graphics`
      : `${title} 3D gaming cover illustration, 16:9 YouTube thumbnail`;
  }

  // Ensure high quality YouTube thumbnail styling keywords are attached
  const enhancedPrompt = isUpgrade && !customInstructions
    ? `Remastered upgraded YouTube thumbnail based on original cover for ${title}, ${cleanImagePrompt}, 16:9 wide aspect ratio, high CTR cover art, 4k resolution, cinematic lighting, sharp detail`
    : `${cleanImagePrompt}, 16:9 wide aspect ratio, high CTR YouTube cover art, 4k resolution, cinematic lighting, sharp detail, no random portraits`;

  // Step 2: Image Generation with Fallback (OpenAI DALL-E 3 -> Google Imagen 3 -> Pollinations FLUX)

  // Attempt A: OpenAI DALL-E 3
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log('🎨 Generating thumbnail with OpenAI DALL-E 3...');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 25000 });
      const result = await withTimeout(
        openai.images.generate({
          model: 'dalle-3',
          prompt: enhancedPrompt,
          n: 1,
          size: '1024x1024',
        }),
        60000,
        'DALL-E 3 timeout'
      );
      const imageUrl = result.data?.[0]?.url;
      if (imageUrl) return imageUrl;
    } catch (err: any) {
      console.warn(`OpenAI DALL-E 3 failed: ${err.message}. Trying Imagen 3 fallback...`);
    }
  }

  // Attempt B: Google Imagen 3
  if (process.env.GEMINI_API_KEY) {
    try {
      console.log('🎨 Generating thumbnail with Google Imagen 3...');
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${process.env.GEMINI_API_KEY}`,
        {
          instances: [{ prompt: enhancedPrompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: '16:9',
          },
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 25000 }
      );
      const base64Image = response.data?.predictions?.[0]?.bytesBase64Encoded;
      if (base64Image) {
        return `data:image/jpeg;base64,${base64Image}`;
      }
    } catch (err: any) {
      console.warn(`⚠️ Google Imagen 3 failed: ${err.message}. Trying Pollinations FLUX fallback...`);
    }
  }

  // Attempt C: Fast Pollinations FLUX AI Model with Prompt Enhancement
  console.log('🎨 Generating thumbnail with Pollinations FLUX AI...');
  const encodedPrompt = encodeURIComponent(enhancedPrompt);
  const seed = Math.floor(Math.random() * 900000) + 100000;
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&nologo=true&enhance=true&model=flux&seed=${seed}`;
};

export interface AIContentSuggestion {
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl: string;
  trendReason: string;
}

/**
 * 6. Generate Complete Video Post Suggestion based on YouTube Niche Trend & Autocomplete Keywords
 */
export const generateAIContentSuggestion = async (
  trendTitle: string,
  trendKeywords: string[],
  niche: string = 'Technology'
): Promise<AIContentSuggestion> => {
  const yr = new Date().getFullYear();
  const prompt = `You are a viral YouTube Creator Strategist.
CRITICAL SYSTEM CONTEXT: The current calendar year is dynamically evaluated as ${yr}. Always use the active current year (which is ${yr}) and NEVER use past years for any year references!

A video titled "${trendTitle}" is currently trending on YouTube in the "${niche}" niche.
Real YouTube search autocomplete keywords typed by viewers: ${JSON.stringify(trendKeywords)}

Perform deep creative research and generate a complete NEW video post suggestion for a content creator in this niche.

Respond STRICTLY in JSON format:
{
  "title": "Viral Clickworthy Title for New Video",
  "description": "Engaging description hook explaining what to cover in this new video...",
  "tags": ["keyword1", "keyword2", "keyword3", "keyword4", "keyword5", "keyword6", "keyword7", "keyword8"],
  "trendReason": "Why this video idea will gain massive views based on current YouTube search intent..."
}`;

  const rawJson = await runTextAIWithFallback(prompt);
  let title = `How to Master ${trendTitle}`;
  let description = `Full breakdown and complete guide on ${trendTitle}.`;
  let tags = trendKeywords.slice(0, 8);
  let trendReason = 'High viral search demand on YouTube right now.';

  try {
    const parsed = JSON.parse(rawJson.replace(/```json|```/g, '').trim());
    if (parsed.title) title = parsed.title;
    if (parsed.description) description = parsed.description;
    if (parsed.tags) tags = parsed.tags;
    if (parsed.trendReason) trendReason = parsed.trendReason;
  } catch (e) {
    // fallback
  }

  // Generate thumbnail image
  let thumbnailUrl = '';
  try {
    thumbnailUrl = await generateAIThumbnail(title);
  } catch (e) {
    thumbnailUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(title)}?width=1280&height=720&nologo=true`;
  }

  return {
    title,
    description,
    tags,
    thumbnailUrl,
    trendReason,
  };
};
