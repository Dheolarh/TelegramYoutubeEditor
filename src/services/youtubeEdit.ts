import axios from 'axios';
import { prisma } from '../config/db';
import { getValidAccessToken } from './youtubeVideos';

export interface CommentItem {
  commentId: string;
  authorName: string;
  textDisplay: string;
  publishedAt: string;
}

/**
 * Helper to fetch full video snippet required for youtube videos.update API call.
 */
const getFullVideoSnippet = async (accessToken: string, youtubeVideoId: string) => {
  const response = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      id: youtubeVideoId,
      part: 'snippet',
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const items = response.data.items;
  if (!items || items.length === 0) {
    throw new Error('Video not found on YouTube.');
  }

  return items[0].snippet;
};

/**
 * Update Video Title on YouTube.
 */
export const updateVideoTitle = async (
  userId: string,
  youtubeVideoId: string,
  newTitle: string
): Promise<string> => {
  const accessToken = await getValidAccessToken(userId);
  const snippet = await getFullVideoSnippet(accessToken, youtubeVideoId);

  snippet.title = newTitle;

  const response = await axios.put(
    'https://www.googleapis.com/youtube/v3/videos',
    {
      id: youtubeVideoId,
      snippet,
    },
    {
      params: { part: 'snippet' },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const updatedTitle = response.data.snippet.title;

  // Update local DB
  await prisma.video.updateMany({
    where: { youtubeVideoId },
    data: { title: updatedTitle },
  });

  return updatedTitle;
};

/**
 * Update Video Description on YouTube.
 */
export const updateVideoDescription = async (
  userId: string,
  youtubeVideoId: string,
  newDescription: string
): Promise<string> => {
  const accessToken = await getValidAccessToken(userId);
  const snippet = await getFullVideoSnippet(accessToken, youtubeVideoId);

  snippet.description = newDescription;

  const response = await axios.put(
    'https://www.googleapis.com/youtube/v3/videos',
    {
      id: youtubeVideoId,
      snippet,
    },
    {
      params: { part: 'snippet' },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const updatedDesc = response.data.snippet.description;

  // Update local DB
  await prisma.video.updateMany({
    where: { youtubeVideoId },
    data: { description: updatedDesc },
  });

  return updatedDesc;
};

/**
 * Update Video Tags on YouTube.
 */
export const updateVideoTags = async (
  userId: string,
  youtubeVideoId: string,
  newTags: string[]
): Promise<string[]> => {
  const accessToken = await getValidAccessToken(userId);
  const snippet = await getFullVideoSnippet(accessToken, youtubeVideoId);

  snippet.tags = newTags;

  const response = await axios.put(
    'https://www.googleapis.com/youtube/v3/videos',
    {
      id: youtubeVideoId,
      snippet,
    },
    {
      params: { part: 'snippet' },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  const updatedTags = response.data.snippet.tags || [];

  // Update local DB
  await prisma.video.updateMany({
    where: { youtubeVideoId },
    data: { tags: updatedTags },
  });

  return updatedTags;
};

/**
 * Upload Video Thumbnail to YouTube from Image Buffer.
 */
export const updateVideoThumbnail = async (
  userId: string,
  youtubeVideoId: string,
  imageBuffer: Buffer,
  mimeType: string = 'image/jpeg'
): Promise<string> => {
  const accessToken = await getValidAccessToken(userId);

  const response = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/thumbnails/set',
    imageBuffer,
    {
      params: { videoId: youtubeVideoId },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mimeType,
      },
    }
  );

  const thumbnailUrl = response.data.items?.[0]?.default?.url || '';

  // Update local DB
  await prisma.video.updateMany({
    where: { youtubeVideoId },
    data: { thumbnailUrl },
  });

  return thumbnailUrl;
};

/**
 * Fetch Top Comments for a Video.
 */
export const fetchVideoComments = async (
  userId: string,
  youtubeVideoId: string,
  maxResults: number = 5
): Promise<CommentItem[]> => {
  const accessToken = await getValidAccessToken(userId);

  const response = await axios.get('https://www.googleapis.com/youtube/v3/commentThreads', {
    params: {
      videoId: youtubeVideoId,
      part: 'snippet',
      maxResults,
      order: 'relevance',
    },
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const items = response.data.items || [];
  return items.map((item: any) => {
    const topComment = item.snippet.topLevelComment.snippet;
    return {
      commentId: item.snippet.topLevelComment.id,
      authorName: topComment.authorDisplayName,
      textDisplay: topComment.textDisplay,
      publishedAt: topComment.publishedAt,
    };
  });
};

/**
 * Reply to a YouTube Comment.
 */
export const replyToComment = async (
  userId: string,
  parentCommentId: string,
  replyText: string
): Promise<void> => {
  const accessToken = await getValidAccessToken(userId);

  await axios.post(
    'https://www.googleapis.com/youtube/v3/comments',
    {
      snippet: {
        parentId: parentCommentId,
        textOriginal: replyText,
      },
    },
    {
      params: { part: 'snippet' },
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
};
