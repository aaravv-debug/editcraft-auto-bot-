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

export function getGmailUser(): string {
  return (process.env.GMAIL_USER || process.env.EMAIL || process.env.GMAIL || process.env.USER_EMAIL || 'editcraftstudio19@gmail.com').trim();
}

export function getGmailPass(): string {
  return (process.env.GMAIL_APP_PASSWORD || process.env.APP_PASSWORD || process.env.GMAIL_PASSWORD || process.env.PASSWORD || process.env.GMAIL_PASS || '').replace(/\s+/g, '');
}

function getImapClient(): ImapFlow {
  const user = getGmailUser().toLowerCase();
  const pass = getGmailPass();

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
  const user = getGmailUser().toLowerCase();
  const pass = getGmailPass();

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

let isProcessing = false;

export async function runSafeEmailCycle(): Promise<number> {
  if (isProcessing) {
    return 0;
  }
  isProcessing = true;
  try {
    // 30-second timeout guarantee so no mail check ever hangs the bot
    const result = await Promise.race([
      processUnreadEmails(),
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error('Email check timed out after 30 seconds')), 30000)
      ),
    ]);
    return result;
  } catch (err: any) {
    console.error(`[Mail Engine] Cycle error:`, err.message);
    stats.lastError = err.message;
    stats.status = 'error';
    return 0;
  } finally {
    isProcessing = false;
  }
}

export async function processUnreadEmails(): Promise<number> {
  const myEmail = getGmailUser().toLowerCase();
  stats.status = 'checking';
  stats.lastChecked = new Date();
  stats.lastError = null;

  const client = getImapClient();
  let repliedCount = 0;

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');

    try {
      const seqList = await client.search({ seen: false });
      if (!seqList || seqList.length === 0) {
        stats.status = 'idle';
        return 0;
      }

      console.log(`[${new Date().toISOString()}] Found ${seqList.length} unread message(s).`);

      const seqRange = seqList.slice(0, 10).join(',');
      const rawMessages: { uid: number; source: Buffer }[] = [];

      for await (const msg of client.fetch(seqRange, { source: true, uid: true })) {
        if (msg.source) {
          rawMessages.push({ uid: msg.uid, source: msg.source });
        }
      }

      for (const item of rawMessages) {
        try {
          const parsed = await simpleParser(item.source);
          const fromAddress = parsed.from?.value?.[0]?.address || '';
          const fromName = parsed.from?.value?.[0]?.name || fromAddress;
          const subject = parsed.subject || 'No Subject';
          const messageId = parsed.messageId;
          const bodyText = parsed.text || parsed.html || '';

          if (isAutomatedOrIgnored(fromAddress, myEmail)) {
            console.log(`[Ignored] Skipping system/automated email from: ${fromAddress}`);
            await client.messageFlagsAdd({ uid: item.uid }, ['\\Seen'], { uid: true });
            continue;
          }

          console.log(`[Lead Detected] From: ${fromName} <${fromAddress}> - Subject: "${subject}"`);

          const aiReply = await generateEmailReply(fromAddress, fromName, subject, bodyText);

          const transporter = getSmtpTransport();
          const replySubject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;

          await transporter.sendMail({
            from: `"Aaravsinh Rathod - EditCraftStudio" <${getGmailUser()}>`,
            to: fromAddress,
            subject: replySubject,
            text: aiReply,
            inReplyTo: messageId,
            references: messageId,
          });

          console.log(`[Replied] Successfully sent AI proposal to: ${fromAddress}`);

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
  } catch (err: any) {
    stats.status = 'error';
    stats.lastError = err.message;
    console.error('Error during mail check cycle:', err.message);
  } finally {
    if (client.usable) {
      await client.logout().catch(() => {});
    }
    stats.status = 'idle';
  }

  return repliedCount;
}
