import axios from 'axios';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/**
 * Generate Google OAuth 2.0 authorization URL carrying the creator's Telegram Chat ID in state.
 */
export const getGoogleAuthUrl = (telegramChatId: string): string => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

  const scopes = [
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ].join(' ');

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopes,
    access_type: 'offline',
    prompt: 'consent', // Forces refresh token delivery
    state: telegramChatId,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

/**
 * Exchange OAuth authorization code for Access & Refresh tokens.
 */
export const exchangeCodeForTokens = async (code: string): Promise<OAuthTokens> => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback';

  const response = await axios.post(
    'https://oauth2.googleapis.com/token',
    {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    },
    { timeout: 8000 }
  );

  return {
    accessToken: response.data.access_token,
    refreshToken: response.data.refresh_token,
    expiresIn: response.data.expires_in,
  };
};

/**
 * Refresh an expired Google OAuth access token using a stored refresh token.
 */
export const refreshAccessToken = async (refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> => {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

  const response = await axios.post(
    'https://oauth2.googleapis.com/token',
    {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    },
    { timeout: 8000 }
  );

  return {
    accessToken: response.data.access_token,
    expiresIn: response.data.expires_in,
  };
};
