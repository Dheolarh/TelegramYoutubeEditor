import axios from 'axios';

export interface ChannelMetadata {
  id: string;
  title: string;
  description: string;
  subscriberCount: number;
}

/**
 * Fetch authenticated YouTube channel details using YouTube Data API.
 */
export const fetchChannelMetadata = async (accessToken: string): Promise<ChannelMetadata> => {
  const response = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: {
      mine: true,
      part: 'snippet,statistics',
    },
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const items = response.data.items;
  if (!items || items.length === 0) {
    throw new Error('No YouTube channel found for the authenticated user.');
  }

  const channel = items[0];
  return {
    id: channel.id,
    title: channel.snippet.title,
    description: channel.snippet.description || '',
    subscriberCount: parseInt(channel.statistics.subscriberCount || '0', 10),
  };
};
