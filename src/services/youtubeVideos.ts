import axios from 'axios';
import { prisma } from '../config/db';
import { refreshAccessToken } from './youtubeAuth';

export interface VideoItem {
  id: string;
  youtubeVideoId: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailUrl: string;
  duration: string;
  isShort: boolean;
  publishedAt: string;
}

/**
 * Helper to ensure a valid, unexpired access token for YouTube API calls.
 */
export const getValidAccessToken = async (userId: string): Promise<string> => {
  const account = await prisma.youTubeAccount.findFirst({
    where: { userId },
  });

  if (!account) {
    throw new Error('No connected YouTube account found.');
  }

  // If token expires in less than 5 minutes, refresh it automatically
  if (account.expiresAt < new Date(Date.now() + 5 * 60 * 1000)) {
    if (!account.refreshToken) {
      throw new Error('OAuth token expired and no refresh token available. Please reconnect via /start.');
    }
    const newTokens = await refreshAccessToken(account.refreshToken);
    const updated = await prisma.youTubeAccount.update({
      where: { id: account.id },
      data: {
        accessToken: newTokens.accessToken,
        expiresAt: new Date(Date.now() + newTokens.expiresIn * 1000),
      },
    });
    return updated.accessToken;
  }

  return account.accessToken;
};

/**
 * Helper to parse ISO 8601 duration (e.g. PT2M30S) and check if it's a Short (<= 3 mins).
 */
const parseIsShort = (isoDuration: string): boolean => {
  const match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return false;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  return totalSeconds <= 180; // Shorts are <= 3 minutes (180s)
};

/**
 * Fetch recent uploads for a channel and cache them in PostgreSQL.
 */
export const fetchRecentVideos = async (
  userId: string,
  channelId: string,
  maxResults: number = 5
): Promise<VideoItem[]> => {
  const accessToken = await getValidAccessToken(userId);

  // 1. Get channel's uploads playlist ID
  const channelRes = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: {
      id: channelId,
      part: 'contentDetails',
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const uploadsPlaylistId = channelRes.data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error('Could not find uploads playlist for channel.');
  }

  // 2. Get recent playlist items
  const playlistRes = await axios.get('https://www.googleapis.com/youtube/v3/playlistItems', {
    params: {
      playlistId: uploadsPlaylistId,
      part: 'snippet',
      maxResults,
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const videoIds = playlistRes.data.items.map((item: any) => item.snippet.resourceId.videoId).join(',');
  if (!videoIds) return [];

  // 3. Get full video details (snippet, contentDetails)
  const videosRes = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      id: videoIds,
      part: 'snippet,contentDetails',
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const channelRecord = await prisma.channel.findUnique({
    where: { youtubeChannelId: channelId },
  });

  if (!channelRecord) {
    throw new Error('Channel record not found in database.');
  }

  const results: VideoItem[] = [];

  for (const item of videosRes.data.items) {
    const duration = item.contentDetails.duration || 'PT0S';
    const isShort = parseIsShort(duration);

    const videoData = {
      channelId: channelRecord.id,
      youtubeVideoId: item.id,
      title: item.snippet.title,
      description: item.snippet.description || '',
      tags: item.snippet.tags || [],
      thumbnailUrl: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url || '',
      duration,
      isShort,
      publishedAt: new Date(item.snippet.publishedAt),
    };

    // Upsert into PostgreSQL DB
    const saved = await prisma.video.upsert({
      where: { youtubeVideoId: item.id },
      update: videoData,
      create: videoData,
    });

    results.push({
      id: saved.id,
      youtubeVideoId: saved.youtubeVideoId,
      title: saved.title,
      description: saved.description || '',
      tags: saved.tags,
      thumbnailUrl: saved.thumbnailUrl || '',
      duration: saved.duration || '',
      isShort: saved.isShort,
      publishedAt: saved.publishedAt?.toISOString() || '',
    });
  }

  return results;
};

/**
 * Search channel videos by keyword title query in local DB / YouTube API.
 */
export const searchChannelVideos = async (
  userId: string,
  channelId: string,
  query: string
): Promise<VideoItem[]> => {
  const channelRecord = await prisma.channel.findUnique({
    where: { youtubeChannelId: channelId },
  });

  if (!channelRecord) return [];

  // First check local DB
  const dbMatches = await prisma.video.findMany({
    where: {
      channelId: channelRecord.id,
      title: { contains: query, mode: 'insensitive' },
    },
    take: 5,
  });

  if (dbMatches.length > 0) {
    return dbMatches.map((v) => ({
      id: v.id,
      youtubeVideoId: v.youtubeVideoId,
      title: v.title,
      description: v.description || '',
      tags: v.tags,
      thumbnailUrl: v.thumbnailUrl || '',
      duration: v.duration || '',
      isShort: v.isShort,
      publishedAt: v.publishedAt?.toISOString() || '',
    }));
  }

  // Fallback: Sync recent videos and search
  const recent = await fetchRecentVideos(userId, channelId, 25);
  return recent.filter((v) => v.title.toLowerCase().includes(query.toLowerCase())).slice(0, 5);
};
