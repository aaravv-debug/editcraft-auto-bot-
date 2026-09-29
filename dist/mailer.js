"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stats = void 0;
exports.runSafeEmailCycle = runSafeEmailCycle;
exports.processUnreadEmails = processUnreadEmails;
exports.startRealtimeListener = startRealtimeListener;
const imapflow_1 = require("imapflow");
const nodemailer_1 = __importDefault(require("nodemailer"));
const mailparser_1 = require("mailparser");
const ai_js_1 = require("./ai.js");
exports.stats = {
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
function isAutomatedOrIgnored(fromAddress, myEmail) {
    const lower = fromAddress.toLowerCase().trim();
    if (!lower)
        return true;
    if (lower.includes(myEmail))
        return true;
    return IGNORED_DOMAINS_AND_PATTERNS.some((pattern) => lower.includes(pattern));
}
function getImapClient() {
    const user = (process.env.GMAIL_USER || '').trim().toLowerCase();
    const pass = (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '');
    if (!user || !pass) {
        throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be configured.');
    }
    return new imapflow_1.ImapFlow({
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
    return nodemailer_1.default.createTransport({
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
async function runSafeEmailCycle() {
    if (isProcessing) {
        return 0;
    }
    isProcessing = true;
    try {
        return await processUnreadEmails();
    }
    finally {
        isProcessing = false;
    }
}
async function processUnreadEmails() {
    const myEmail = (process.env.GMAIL_USER || 'editcraftstudio19@gmail.com').toLowerCase().trim();
    exports.stats.status = 'checking';
    exports.stats.lastChecked = new Date();
    exports.stats.lastError = null;
    const client = getImapClient();
    let repliedCount = 0;
    try {
        await client.connect();
        const lock = await client.getMailboxLock('INBOX');
        try {
            // Find unread messages by sequence numbers
            const seqList = await client.search({ seen: false });
            if (!seqList || seqList.length === 0) {
                exports.stats.status = 'idle';
                return 0;
            }
            console.log(`[${new Date().toISOString()}] Found ${seqList.length} unread message(s).`);
            // 1. Process from oldest to newest (up to 15 at once)
            const seqRange = seqList.slice(0, 15).join(',');
            const rawMessages = [];
            for await (const msg of client.fetch(seqRange, { source: true, uid: true })) {
                if (msg.source) {
                    rawMessages.push({ uid: msg.uid, source: msg.source });
                }
            }
            // 2. Process each message sequentially
            for (const item of rawMessages) {
                try {
                    const parsed = await (0, mailparser_1.simpleParser)(item.source);
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
                    const aiReply = await (0, ai_js_1.generateEmailReply)(fromAddress, fromName, subject, bodyText);
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
                    exports.stats.emailsProcessed++;
                }
                catch (itemErr) {
                    console.error(`Error processing UID ${item.uid}:`, itemErr.message);
                }
            }
        }
        finally {
            lock.release();
        }
        await client.logout();
        exports.stats.status = 'idle';
    }
    catch (err) {
        exports.stats.status = 'error';
        exports.stats.lastError = err.message;
        console.error('Error during mail check cycle:', err.message);
    }
    return repliedCount;
}
function startRealtimeListener() {
    const listen = async () => {
        let client = null;
        try {
            client = getImapClient();
            await client.connect();
            console.log('⚡ [REALTIME IDLE] Connected to Gmail push notifications.');
            const lock = await client.getMailboxLock('INBOX');
            client.on('exists', (data) => {
                console.log(`⚡ [REALTIME IDLE] Incoming email event (Inbox count: ${data.count}). Processing...`);
                runSafeEmailCycle().catch((err) => console.error('[REALTIME] Cycle error:', err));
            });
            while (client.usable) {
                try {
                    await client.idle();
                }
                catch {
                    break;
                }
            }
            lock.release();
        }
        catch (err) {
            console.warn('[REALTIME IDLE] Connection dropped:', err.message, '- Auto-reconnecting in 10s...');
        }
        finally {
            if (client && client.usable) {
                await client.logout().catch(() => { });
            }
            setTimeout(listen, 10000);
        }
    };
    listen().catch(console.error);
}
