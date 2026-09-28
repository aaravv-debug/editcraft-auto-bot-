import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');

export interface StoredAuth {
  tokens: any;
  userEmail: string;
  connectedAt: string;
}

export function getOAuth2Client(reqHost?: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  
  // Dynamically detect redirect URI based on Railway host or custom domain
  let redirectUri = process.env.REDIRECT_URI;
  if (!redirectUri && reqHost) {
    const protocol = reqHost.includes('localhost') ? 'http' : 'https';
    redirectUri = `${protocol}://${reqHost}/auth/google/callback`;
  }
  if (!redirectUri) {
    redirectUri = 'http://localhost:3000/auth/google/callback';
  }

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in environment variables.');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

export function generateAuthUrl(reqHost?: string): string {
  const oauth2Client = getOAuth2Client(reqHost);
  const scopes = [
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/userinfo.email',
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  });
}

export function saveTokens(tokens: any, userEmail: string) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const data: StoredAuth = {
    tokens,
    userEmail,
    connectedAt: new Date().toISOString(),
  };

  fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function getStoredAuth(): StoredAuth | null {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const raw = fs.readFileSync(TOKEN_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error('Failed reading token file:', err);
  }
  return null;
}

export function isConnected(): boolean {
  const auth = getStoredAuth();
  return !!(auth && auth.tokens && (auth.tokens.refresh_token || auth.tokens.access_token));
}
