"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOAuth2Client = getOAuth2Client;
exports.generateAuthUrl = generateAuthUrl;
exports.saveTokens = saveTokens;
exports.getStoredAuth = getStoredAuth;
exports.isConnected = isConnected;
const googleapis_1 = require("googleapis");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.resolve(process.cwd(), 'data');
const TOKEN_FILE = path_1.default.join(DATA_DIR, 'tokens.json');
function getOAuth2Client(reqHost) {
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
    return new googleapis_1.google.auth.OAuth2(clientId, clientSecret, redirectUri);
}
function generateAuthUrl(reqHost) {
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
function saveTokens(tokens, userEmail) {
    if (!fs_1.default.existsSync(DATA_DIR)) {
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data = {
        tokens,
        userEmail,
        connectedAt: new Date().toISOString(),
    };
    fs_1.default.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), 'utf-8');
}
function getStoredAuth() {
    try {
        if (fs_1.default.existsSync(TOKEN_FILE)) {
            const raw = fs_1.default.readFileSync(TOKEN_FILE, 'utf-8');
            return JSON.parse(raw);
        }
    }
    catch (err) {
        console.error('Failed reading token file:', err);
    }
    return null;
}
function isConnected() {
    const auth = getStoredAuth();
    return !!(auth && auth.tokens && (auth.tokens.refresh_token || auth.tokens.access_token));
}
