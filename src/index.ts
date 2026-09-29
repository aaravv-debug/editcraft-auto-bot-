import 'dotenv/config';
import express from 'express';
import { google } from 'googleapis';
import { generateAuthUrl, getOAuth2Client, getStoredAuth, isConnected as isOAuthConnected, saveTokens } from './oauth.js';
import { processUnreadEmails as processEmailsImap, stats as imapStats } from './mailer.js';
import { processUnreadEmails as processEmailsOAuth, stats as oauthStats } from './gmailService.js';

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const intervalMinutes = parseInt(process.env.CHECK_INTERVAL_MINUTES || '2', 10);

app.use(express.json());

const isAppPasswordMode = !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);

import { startRealtimeListener, runSafeEmailCycle } from './mailer.js';

function getActiveStats() {
  if (isAppPasswordMode) {
    return {
      connected: true,
      userEmail: process.env.GMAIL_USER || '',
      emailsProcessed: imapStats.emailsProcessed,
      lastChecked: imapStats.lastChecked,
      mode: 'Verified App Password (IMAP/SMTP)',
    };
  }

  const auth = getStoredAuth();
  const oauthActive = isOAuthConnected();
  return {
    connected: oauthActive,
    userEmail: auth?.userEmail || '',
    emailsProcessed: oauthStats.emailsProcessed,
    lastChecked: oauthStats.lastChecked,
    mode: 'Google OAuth2',
  };
}

async function runMailCheck(): Promise<number> {
  if (isAppPasswordMode) {
    return await processEmailsImap();
  }
  return await processEmailsOAuth();
}

// Main Dashboard
app.get('/', (req, res) => {
  const current = getActiveStats();

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EditCraftStudio AI Mail Automation</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }
    body { background: #0b0f19; color: #f3f4f6; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 16px; padding: 36px; max-width: 580px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); }
    .header { text-align: center; margin-bottom: 28px; }
    .badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; font-size: 13px; font-weight: 600; margin-bottom: 12px; }
    .badge.active { background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge.disconnected { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    h1 { font-size: 24px; font-weight: 700; color: #ffffff; margin-bottom: 6px; }
    p.subtitle { font-size: 14px; color: #9ca3af; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 24px 0; }
    .stat-box { background: #1f2937; padding: 16px; border-radius: 12px; border: 1px solid #374151; }
    .stat-label { font-size: 12px; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.5px; }
    .stat-value { font-size: 18px; font-weight: 600; color: #ffffff; margin-top: 4px; }
    .actions { display: flex; flex-direction: column; gap: 12px; margin-top: 24px; }
    .btn { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; padding: 14px 20px; font-size: 15px; font-weight: 600; border-radius: 10px; text-decoration: none; cursor: pointer; transition: all 0.2s ease; border: none; }
    .btn-google { background: #ffffff; color: #111827; }
    .btn-google:hover { background: #f3f4f6; transform: translateY(-1px); }
    .btn-primary { background: #4f46e5; color: #ffffff; }
    .btn-primary:hover { background: #4338ca; }
    .info-footer { margin-top: 20px; text-align: center; font-size: 13px; color: #6b7280; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="badge ${current.connected ? 'active' : 'disconnected'}">
        <span class="dot"></span> ${current.connected ? 'Active & Monitoring 24/7' : 'Action Required: Connect Gmail'}
      </div>
      <h1>EditCraftStudio Mail Bot</h1>
      <p class="subtitle">AI Lead Assistant Powered by Google Gemini</p>
    </div>

    ${current.connected ? `
      <div class="grid">
        <div class="stat-box">
          <div class="stat-label">Connected Gmail</div>
          <div class="stat-value" style="font-size: 14px; word-break: break-all;">${current.userEmail}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Leads Replied</div>
          <div class="stat-value">${current.emailsProcessed}</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Check Interval</div>
          <div class="stat-value">Every ${intervalMinutes} min</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Last Check</div>
          <div class="stat-value" style="font-size: 13px;">${current.lastChecked ? new Date(current.lastChecked).toLocaleTimeString() : 'Pending...'}</div>
        </div>
      </div>

      <div class="actions">
        <button class="btn btn-primary" onclick="triggerCheck()">⚡ Run Mail Check Now</button>
      </div>
    ` : `
      <div style="background: rgba(79, 70, 229, 0.1); border: 1px solid rgba(79, 70, 229, 0.3); border-radius: 12px; padding: 18px; margin: 20px 0; text-align: center;">
        <p style="font-size: 14px; color: #c7d2fe; line-height: 1.5;">
          Connect your Google account securely with OAuth2. <strong>No passwords are requested or shared.</strong>
        </p>
      </div>

      <div class="actions">
        <a class="btn btn-google" href="/auth/google">
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.616z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.039l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/></svg>
          Sign in with Google
        </a>
      </div>
    `}

    <div class="info-footer">
      EditCraftStudio • Aaravsinh Rathod • Powered by Gemini AI
    </div>
  </div>

  <script>
    async function triggerCheck() {
      const res = await fetch('/trigger', { method: 'POST' });
      const data = await res.json();
      alert('Mail check finished! Processed: ' + (data.replied ?? 0) + ' email(s).');
      window.location.reload();
    }
  </script>
</body>
</html>`;

  res.send(html);
});

// OAuth initiation route
app.get('/auth/google', (req, res) => {
  const host = req.get('host');
  try {
    const authUrl = generateAuthUrl(host);
    res.redirect(authUrl);
  } catch (err: any) {
    res.status(500).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Google OAuth Setup Required</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700&display=swap" rel="stylesheet">
  <style>
    body { background: #0b0f19; color: #fff; font-family: 'Plus Jakarta Sans', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .box { background: #111827; border: 1px solid #1f2937; padding: 36px; border-radius: 16px; max-width: 520px; line-height: 1.6; }
    h2 { color: #f59e0b; margin-bottom: 12px; }
    p { color: #9ca3af; margin-bottom: 16px; font-size: 14px; }
    code { background: #1f2937; padding: 2px 6px; border-radius: 4px; color: #a5b4fc; }
    a.btn { display: inline-block; background: #4f46e5; color: white; padding: 10px 18px; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 14px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Google OAuth Setup Note</h2>
    <p>Your bot is currently running in <strong>App Password Mode</strong> (connected to <code>${process.env.GMAIL_USER || 'your Gmail'}</code>).</p>
    <p>If you want to use the <em>Sign in with Google</em> button for other clients, add these two variables in Railway:</p>
    <p>• <code>GOOGLE_CLIENT_ID</code><br>• <code>GOOGLE_CLIENT_SECRET</code></p>
    <a class="btn" href="/">Return to Dashboard</a>
  </div>
</body>
</html>`);
  }
});

// OAuth Callback route
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code as string;
  const error = req.query.error as string;
  const host = req.get('host');

  if (error) {
    return res.status(400).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Google Permission Note</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700&display=swap" rel="stylesheet">
  <style>
    body { background: #0b0f19; color: #fff; font-family: 'Plus Jakarta Sans', sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .box { background: #111827; border: 1px solid #1f2937; padding: 36px; border-radius: 16px; max-width: 500px; text-align: center; }
    h2 { color: #ef4444; margin-bottom: 12px; }
    p { color: #9ca3af; margin-bottom: 20px; font-size: 14px; line-height: 1.5; }
    a.btn { background: #4f46e5; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Permission Denied: ${error}</h2>
    <p>The login was cancelled or your Google account was not added to the <strong>Test users</strong> list in Google Cloud Console.</p>
    <p>To allow any user to sign in, set the OAuth Consent Screen to <strong>Publish App</strong> (In Production) in Google Cloud Console.</p>
    <a class="btn" href="/">Back to Dashboard</a>
  </div>
</body>
</html>`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code from Google.');
  }

  try {
    const oauth2Client = getOAuth2Client(host);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const userEmail = userInfo.data.email || 'unknown@gmail.com';

    saveTokens(tokens, userEmail);
    console.log(`[OAuth Success] Connected Gmail account: ${userEmail}`);

    runMailCheck().catch((err) => console.error('Initial check error:', err));

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Connected Successfully</title>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@500;700&display=swap" rel="stylesheet">
  <style>
    body { background: #0b0f19; color: #fff; font-family: 'Plus Jakarta Sans', sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .box { background: #111827; border: 1px solid #1f2937; padding: 40px; border-radius: 16px; text-align: center; max-width: 450px; }
    h2 { color: #10b981; margin-bottom: 12px; }
    p { color: #9ca3af; margin-bottom: 24px; font-size: 15px; }
    a { background: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 8px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="box">
    <h2>🎉 Connected Successfully!</h2>
    <p>Account <strong>${userEmail}</strong> is now linked to EditCraftStudio Automation. Incoming leads will be handled automatically.</p>
    <a href="/">Go to Dashboard</a>
  </div>
</body>
</html>`);
  } catch (err: any) {
    console.error('Error exchanging OAuth code:', err);
    res.status(500).send(`Failed to authenticate with Google: ${err.message}`);
  }
});

// Manual trigger API
app.post('/trigger', async (req, res) => {
  try {
    const count = await runMailCheck();
    res.json({ success: true, replied: count, stats: getActiveStats() });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Healthcheck
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

app.listen(port, '0.0.0.0', () => {
  const current = getActiveStats();
  console.log(`====================================================`);
  console.log(`🚀 EditCraftStudio Mail Bot running on port ${port}`);
  console.log(`🔒 Mode: ${current.mode}`);
  console.log(`📧 Connected Account: ${current.userEmail || 'Waiting for login'}`);
  console.log(`⏱️  Check interval: Every ${intervalMinutes} minute(s)`);
  console.log(`====================================================`);

  if (current.connected) {
    runMailCheck().catch((err) => console.error('Initial mail check error:', err));
    if (isAppPasswordMode) {
      startRealtimeListener();
    }
  }

  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(() => {
    const state = getActiveStats();
    if (state.connected) {
      console.log(`[${new Date().toISOString()}] Running 2-minute safety check...`);
      runSafeEmailCycle().catch((err) => console.error('Interval check error:', err));
    }
  }, intervalMs);
});
