import 'dotenv/config';
import express from 'express';
import { processUnreadEmails, stats } from './mailer.js';

const app = express();
const port = parseInt(process.env.PORT || '3000', 10);
const intervalMinutes = parseInt(process.env.CHECK_INTERVAL_MINUTES || '15', 10);

app.use(express.json());

// Health Check & Status Endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'EditCraftStudio AI Mail Automation System',
    status: 'Running',
    lastChecked: stats.lastChecked ? stats.lastChecked.toISOString() : 'Never',
    totalEmailsProcessed: stats.emailsProcessed,
    currentJobStatus: stats.status,
    lastError: stats.lastError,
    checkIntervalMinutes: intervalMinutes,
    configuredUser: process.env.GMAIL_USER ? `${process.env.GMAIL_USER.substring(0, 4)}***@gmail.com` : 'Not Configured',
    geminiConfigured: !!process.env.GEMINI_API_KEY,
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Manual trigger endpoint
app.post('/trigger', async (req, res) => {
  try {
    const count = await processUnreadEmails();
    res.json({ success: true, replied: count, stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`====================================================`);
  console.log(`🚀 EditCraftStudio Mail Bot running on port ${port}`);
  console.log(`⏱️  Check interval: Every ${intervalMinutes} minute(s)`);
  console.log(`====================================================`);

  // Run immediately on start
  processUnreadEmails().catch((err) => console.error('Initial check error:', err));

  // Schedule regular checks
  const intervalMs = intervalMinutes * 60 * 1000;
  setInterval(() => {
    console.log(`[${new Date().toISOString()}] Running scheduled mail check...`);
    processUnreadEmails().catch((err) => console.error('Interval check error:', err));
  }, intervalMs);
});
