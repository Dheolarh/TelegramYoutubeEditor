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
 * Fetch real-time Google Trends daily search queries.
 */
export const fetchLiveTrends = async (): Promise<string[]> => {
  try {
    const res = await axios.get('https://trends.google.com/trends/trendingsearches/daily/rss?geo=US', { timeout: 3000 });
    const matches = [...res.data.matchAll(/<title>(.*?)<\/title>/g)].map(m => m[1]).filter(t => t && t !== 'Daily Search Trends');
    return matches.slice(0, 10);
  } catch (e) {
    return ['latest updates 2025', 'how to fixed', 'best guide', 'new patch release', 'trending topic'];
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
  const liveTrends = await fetchLiveTrends();

  const prompt = `You are a YouTube SEO and viral title expert.
Analyze the video details and current live search trends below to generate 3 clickworthy, high-CTR titles.

Current Title: "${currentTitle}"
Description snippet: "${description.slice(0, 300)}"
Tags: ${JSON.stringify(tags)}
Live Google Search Trends Right Now: ${JSON.stringify(liveTrends)}

Incorporate trending viral angles (e.g. 2025 updates, fixes, secrets, or trending search intent) if relevant to boost clickability.

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
      titles: [`🔥 ${currentTitle} (2025 UPDATE)`, `HOW TO: ${currentTitle}`, `BEST GUIDE: ${currentTitle}`],
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

/**
 * 5. Generate AI Thumbnail (Fallback: OpenAI DALL-E 3 -> Imagen 3 -> Pollinations)
 * Analyzes video title & existing thumbnail context to generate an updated visual.
 */
export const generateAIThumbnail = async (
  title: string,
  currentThumbnailUrl?: string
): Promise<string> => {
  // Step 1: Analyze thumbnail concept using Text AI
  const promptAnalysis = `You are a professional YouTube Thumbnail Creative Director.
Create an image generation prompt for a high-CTR YouTube thumbnail for the video titled "${title}".

Analyze visual elements needed for maximum CTR (e.g. bold contrast, dramatic lighting, clear focal subject, vibrant colors, 4k quality).

Respond with ONLY a 1-paragraph visual prompt for AI image generation.`;

  let visualPrompt = '';
  try {
    visualPrompt = await runTextAIWithFallback(promptAnalysis);
  } catch (err) {
    visualPrompt = `Vibrant 4k high-CTR YouTube thumbnail visual for video about ${title}`;
  }

  const enhancedPrompt = `High CTR 16:9 YouTube thumbnail, bold contrast, professional lighting, 4k resolution, eye-catching focal subject: ${visualPrompt}`;

  // Step 2: Image Generation with Fallback (OpenAI DALL-E 3 -> Google Imagen 3 -> Pollinations)

  // Attempt A: OpenAI DALL-E 3
  if (process.env.OPENAI_API_KEY) {
    try {
      console.log('🎨 Generating thumbnail with OpenAI DALL-E 3...');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const result = await openai.images.generate({
        model: 'dalle-3',
        prompt: enhancedPrompt,
        n: 1,
        size: '1024x1024',
      });
      const imageUrl = result.data?.[0]?.url;
      if (imageUrl) return imageUrl;
    } catch (err: any) {
      console.warn(`⚠️ OpenAI DALL-E 3 failed: ${err.message}. Trying Imagen 3 fallback...`);
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
        { headers: { 'Content-Type': 'application/json' } }
      );
      const base64Image = response.data?.predictions?.[0]?.bytesBase64Encoded;
      if (base64Image) {
        return `data:image/jpeg;base64,${base64Image}`;
      }
    } catch (err: any) {
      console.warn(`⚠️ Google Imagen 3 failed: ${err.message}. Trying Pollinations fallback...`);
    }
  }

  // Attempt C: Free Pollinations AI Image Endpoint
  console.log('🎨 Generating thumbnail with Pollinations AI...');
  const encoded = encodeURIComponent(enhancedPrompt);
  return `https://image.pollinations.ai/prompt/${encoded}?width=1280&height=720&nologo=true`;
};
