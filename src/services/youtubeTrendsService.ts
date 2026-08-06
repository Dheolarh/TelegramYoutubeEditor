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

/**
 * Fetch top trending YouTube videos in user's niche/category published in last 48 hours.
 */
export const fetchYouTubeNicheTrends = async (
  userId: string,
  nicheQuery: string = 'Gaming'
): Promise<YouTubeTrendItem[]> => {
  try {
    const accessToken = await getValidAccessToken(userId);

    // Published within last 48 hours
    const publishedAfter = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        q: nicheQuery,
        part: 'snippet',
        type: 'video',
        order: 'viewCount',
        publishedAfter,
        maxResults: 5,
      },
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 8000,
    });

    const items = response.data.items || [];
    const results: YouTubeTrendItem[] = [];

    for (const item of items) {
      const keywords = await fetchYouTubeAutocompleteKeywords(item.snippet.title);
      results.push({
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        snippet: item.snippet.description || '',
        keywords,
      });
    }

    return results;
  } catch (err: any) {
    console.warn('⚠️ YouTube Niche Search error:', err.message);
    // Fallback using autocomplete keywords
    const yr = new Date().getFullYear();
    const fallbackKeywords = await fetchYouTubeAutocompleteKeywords(nicheQuery);
    return [
      {
        title: `${nicheQuery} Latest ${yr} Trends & Secrets`,
        channelTitle: 'YouTube Trends',
        publishedAt: new Date().toISOString(),
        snippet: `Viral topic trending in ${nicheQuery}`,
        keywords: fallbackKeywords,
      },
    ];
  }
};
