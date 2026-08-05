import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import axios from 'axios';

export interface AIMetadataSuggestion {
  titles: string[];
  description: string;
  tags: string[];
}

/**
 * Generate AI-optimized titles, description, and tags.
 * Supports Gemini, OpenAI, and DeepSeek.
 */
export const generateMetadataSuggestions = async (
  currentTitle: string,
  currentDescription: string,
  currentTags: string[],
  niche: string = 'Technology'
): Promise<AIMetadataSuggestion> => {
  const provider = (process.env.AI_TEXT_PROVIDER || 'gemini').toLowerCase();

  const prompt = `You are a YouTube SEO and high-CTR growth expert.
Analyze the video details below and generate optimized YouTube metadata for a video in the "${niche}" niche.

Current Video Title: "${currentTitle}"
Current Description: "${currentDescription}"
Current Tags: ${JSON.stringify(currentTags)}

Respond STRICTLY in JSON format without markdown wrapping, matching this exact schema:
{
  "titles": ["Clickworthy Title 1", "Clickworthy Title 2", "Clickworthy Title 3"],
  "description": "Engaging SEO-friendly description...",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"]
}`;

  let jsonText = '';

  if (provider === 'deepseek') {
    const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
    const deepseek = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey,
    });

    const completion = await deepseek.chat.completions.create({
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    jsonText = completion.choices[0]?.message?.content || '{}';
  } else if (provider === 'openai') {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    });
    jsonText = completion.choices[0]?.message?.content || '{}';
  } else {
    // Default to Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent(prompt);
    jsonText = result.response.text().replace(/```json|```/g, '').trim();
  }

  try {
    const parsed = JSON.parse(jsonText);
    return {
      titles: parsed.titles || [currentTitle],
      description: parsed.description || currentDescription,
      tags: parsed.tags || currentTags,
    };
  } catch (err) {
    console.error('Failed to parse AI response JSON:', jsonText);
    return {
      titles: [currentTitle],
      description: currentDescription,
      tags: currentTags,
    };
  }
};

/**
 * Generate AI YouTube Thumbnail Image.
 * Supports Google Imagen 3 (using GEMINI_API_KEY), OpenAI DALL-E 3, and Banana.dev.
 */
export const generateThumbnailImage = async (prompt: string): Promise<string> => {
  const provider = (process.env.AI_IMAGE_PROVIDER || 'imagen').toLowerCase();
  const enhancedPrompt = `High CTR YouTube video thumbnail, vibrant colors, 4k resolution, eye-catching composition, professional lighting: ${prompt}`;

  if (provider === 'imagen' || provider === 'gemini') {
    // Google's Official Imagen 3 Image Generation Model
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not configured in .env for Google Imagen');

    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${apiKey}`,
      {
        instances: [{ prompt: enhancedPrompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '16:9', // Native YouTube Thumbnail Aspect Ratio!
        },
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const base64Image = response.data?.predictions?.[0]?.bytesBase64Encoded;
    if (!base64Image) throw new Error('Failed to generate image from Google Imagen 3');
    return `data:image/jpeg;base64,${base64Image}`;
  } else if (provider === 'banana') {
    const apiKey = process.env.BANANA_API_KEY;
    if (!apiKey) throw new Error('BANANA_API_KEY is not configured in .env');

    const response = await axios.post(
      'https://api.banana.dev/start/v1',
      {
        apiKey,
        modelInputs: { prompt: enhancedPrompt },
      },
      { headers: { 'Content-Type': 'application/json' } }
    );

    return response.data.modelOutputs?.[0]?.image_url || response.data.image_url;
  } else {
    // Default to OpenAI DALL-E 3
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured in .env for DALL-E 3 image generation');

    const openai = new OpenAI({ apiKey });
    const result = await openai.images.generate({
      model: 'dalle-3',
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1024',
    });

    const imageUrl = result.data?.[0]?.url;
    if (!imageUrl) throw new Error('Failed to generate image from DALL-E 3');
    return imageUrl;
  }
};
