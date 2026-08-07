import axios from 'axios';
import { getValidAccessToken } from './youtubeVideos';

export interface YouTubeTrendItem {
  title: string;
  channelTitle: string;
  viewCount?: string;
  publishedAt: string;
  snippet: string;
  keywords: string[];
}

/**
 * Fetch real-time YouTube Search Autocomplete keywords typed by YouTube viewers.
 */
export const fetchYouTubeAutocompleteKeywords = async (query: string): Promise<string[]> => {
  try {
    const cleanQuery = query.replace(/[^\w\s]/gi, '').split(' ').slice(0, 3).join(' ');
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=${encodeURIComponent(cleanQuery)}`;
    const res = await axios.get(url, { timeout: 3000 });
    const keywords: string[] = res.data?.[1] || [];
    return keywords.slice(0, 10);
  } catch (err: any) {
    console.warn('⚠️ YouTube Autocomplete fetch error:', err.message);
    const yr = new Date().getFullYear();
    return [`${query} ${yr}`, `${query} tutorial`, `${query} review`, `${query} gameplay`, `${query} update` ];
  }
};

export const fetchYouTubeNicheTrends = async (
  userId: string,
  nicheQuery: string = 'Gaming'
): Promise<YouTubeTrendItem[]> => {
  const cleanNiche = nicheQuery.replace(/[^\w\s]/gi, '').split(' ').slice(0, 3).join(' ') || 'Gaming';

  try {
    const accessToken = await getValidAccessToken(userId);
    const publishedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    let response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        q: cleanNiche,
        part: 'snippet',
        type: 'video',
        order: 'viewCount',
        publishedAfter,
        maxResults: 5,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 7000,
    });

    let items = response.data.items || [];

    // Fallback 1: If 0 items found in 48h for narrow query, retry top viewCount videos without date constraint
    if (items.length === 0) {
      console.log(`ℹ️ 0 items found for "${cleanNiche}" in 48h. Retrying top niche videos...`);
      response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
        params: {
          q: cleanNiche,
          part: 'snippet',
          type: 'video',
          order: 'viewCount',
          maxResults: 5,
        },
        headers: { Authorization: `Bearer ${accessToken}` },
        timeout: 7000,
      });
      items = response.data.items || [];
    }

    const results: YouTubeTrendItem[] = [];

    for (const item of items) {
      if (!item?.snippet?.title) continue;
      const keywords = await fetchYouTubeAutocompleteKeywords(item.snippet.title);
      results.push({
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle || 'YouTube Creator',
        publishedAt: item.snippet.publishedAt || new Date().toISOString(),
        snippet: item.snippet.description || '',
        keywords,
      });
    }

    if (results.length > 0) return results;
  } catch (err: any) {
    console.warn('⚠️ YouTube Niche Search error:', err.message);
  }

  // Fallback 2: Guaranteed autocomplete trend items
  const yr = new Date().getFullYear();
  const fallbackKeywords = await fetchYouTubeAutocompleteKeywords(cleanNiche);
  return [
    {
      title: `${cleanNiche} Trends & Viral Secrets (${yr})`,
      channelTitle: 'YouTube Trends',
      publishedAt: new Date().toISOString(),
      snippet: `Viral topic trending in ${cleanNiche}`,
      keywords: fallbackKeywords,
    },
    {
      title: `${cleanNiche} Ultimate Setup & Update`,
      channelTitle: 'YouTube Trends',
      publishedAt: new Date().toISOString(),
      snippet: `High volume viewer search topic`,
      keywords: [`${cleanNiche} update`, `${cleanNiche} tutorial`, `${cleanNiche} tips`],
    },
  ];
};
