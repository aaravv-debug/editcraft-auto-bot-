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

function getImapClient(): ImapFlow {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

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
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

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
      // Find unread messages
      const searchResult = await client.search({ seen: false });
      const messageUids = Array.isArray(searchResult) ? searchResult : [];

      console.log(`[${new Date().toISOString()}] Found ${messageUids.length} unread message(s).`);

      // Process up to 5 at a time
      const uidsToProcess = messageUids.slice(0, 5);

      for (const uid of uidsToProcess) {
        try {
          const messageData = await client.download(String(uid), undefined, { uid: true });
          if (!messageData || !messageData.content) continue;

          const parsed = await simpleParser(messageData.content);
          const fromAddress = parsed.from?.value?.[0]?.address || '';
          const fromName = parsed.from?.value?.[0]?.name || fromAddress;
          const subject = parsed.subject || 'No Subject';
          const messageId = parsed.messageId;
          const bodyText = parsed.text || parsed.html || '';

          // Filter out emails from myself or no sender
          if (!fromAddress || fromAddress.toLowerCase().includes(myEmail)) {
            console.log(`Skipping email from myself/empty: ${fromAddress}`);
            await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
            continue;
          }

          console.log(`Processing lead email from: ${fromName} <${fromAddress}> - Subject: "${subject}"`);

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

          console.log(`Successfully replied to: ${fromAddress}`);

          // 3. Mark as Read in Gmail
          await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });

          repliedCount++;
          stats.emailsProcessed++;
        } catch (itemErr: any) {
          console.error(`Error processing UID ${uid}:`, itemErr.message);
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
