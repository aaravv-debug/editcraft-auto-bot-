import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { generateEmailReply } from './ai.js';

export interface EmailJobStats {
  lastChecked: Date | null;
  emailsProcessed: number;
  lastError: string | null;
  status: 'idle' | 'checking' | 'error';
}

export const stats: EmailJobStats = {
  lastChecked: null,
  emailsProcessed: 0,
  lastError: null,
  status: 'idle',
};

const IGNORED_DOMAINS_AND_PATTERNS = [
  'no-reply',
  'noreply',
  'security@',
  'notification',
  'notifications',
  'facebookmail.com',
  'google.com',
  'accounts.google.com',
  'n8n.io',
  'mailer-daemon',
  'donotreply',
  'newsletter',
  'billing@',
  'updates@',
  'alerts@',
  'verify@',
];

function isAutomatedOrIgnored(fromAddress: string, myEmail: string): boolean {
  const lower = fromAddress.toLowerCase().trim();
  if (!lower) return true;
  if (lower.includes(myEmail)) return true;
  return IGNORED_DOMAINS_AND_PATTERNS.some((pattern) => lower.includes(pattern));
}

function getImapClient(): ImapFlow {
  const user = (process.env.GMAIL_USER || '').trim().toLowerCase();
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!user || !pass) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be configured.');
  }

  return new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: {
      user,
      pass,
    },
    logger: false,
  });
}

function getSmtpTransport() {
  const user = (process.env.GMAIL_USER || '').trim().toLowerCase();
  const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');

  if (!user || !pass) {
    throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be configured.');
  }

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user,
      pass,
    },
  });
}

export async function processUnreadEmails(): Promise<number> {
  const myEmail = (process.env.GMAIL_USER || 'editcraftstudio19@gmail.com').toLowerCase().trim();
  stats.status = 'checking';
  stats.lastChecked = new Date();
  stats.lastError = null;

  const client = getImapClient();
  let repliedCount = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Find unread messages by sequence numbers
      const seqList = await client.search({ seen: false });
      if (!seqList || seqList.length === 0) {
        console.log(`[${new Date().toISOString()}] No unread messages found.`);
        return 0;
      }

      console.log(`[${new Date().toISOString()}] Found ${seqList.length} unread message(s).`);

      // 1. Process from oldest to newest (up to 15 at once)
      const seqRange = seqList.slice(0, 15).join(',');
      const rawMessages: { uid: number; source: Buffer }[] = [];

      for await (const msg of client.fetch(seqRange, { source: true, uid: true })) {
        if (msg.source) {
          rawMessages.push({ uid: msg.uid, source: msg.source });
        }
      }

      // 2. Process each message sequentially
      for (const item of rawMessages) {
        try {
          const parsed = await simpleParser(item.source);
          const fromAddress = parsed.from?.value?.[0]?.address || '';
          const fromName = parsed.from?.value?.[0]?.name || fromAddress;
          const subject = parsed.subject || 'No Subject';
          const messageId = parsed.messageId;
          const bodyText = parsed.text || parsed.html || '';

          // Filter out automated notifications, security codes, and system emails
          if (isAutomatedOrIgnored(fromAddress, myEmail)) {
            console.log(`[Ignored] Skipping system/automated email from: ${fromAddress}`);
            await client.messageFlagsAdd({ uid: item.uid }, ['\\Seen'], { uid: true });
            continue;
          }

          console.log(`[Lead Detected] From: ${fromName} <${fromAddress}> - Subject: "${subject}"`);

          // 1. Generate AI Reply
          const aiReply = await generateEmailReply(fromAddress, fromName, subject, bodyText);

          // 2. Send Reply via SMTP
          const transporter = getSmtpTransport();
          const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

          await transporter.sendMail({
            from: `"Aaravsinh Rathod - EditCraftStudio" <${process.env.GMAIL_USER}>`,
            to: fromAddress,
            subject: replySubject,
            text: aiReply,
            inReplyTo: messageId,
            references: messageId,
          });

          console.log(`[Replied] Successfully sent AI proposal to: ${fromAddress}`);

          // 3. Mark as Read in Gmail
          await client.messageFlagsAdd({ uid: item.uid }, ['\\Seen'], { uid: true });

          repliedCount++;
          stats.emailsProcessed++;
        } catch (itemErr: any) {
          console.error(`Error processing UID ${item.uid}:`, itemErr.message);
        }
      }
    } finally {
      lock.release();
    }

    await client.logout();
    stats.status = 'idle';
  } catch (err: any) {
    stats.status = 'error';
    stats.lastError = err.message;
    console.error('Error during mail check cycle:', err.message);
  }

  return repliedCount;
}
