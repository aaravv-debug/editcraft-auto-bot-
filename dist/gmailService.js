"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stats = void 0;
exports.processUnreadEmails = processUnreadEmails;
const googleapis_1 = require("googleapis");
const oauth_js_1 = require("./oauth.js");
const ai_js_1 = require("./ai.js");
exports.stats = {
    lastChecked: null,
    emailsProcessed: 0,
    lastError: null,
    status: 'not_connected',
    connectedUser: null,
};
function extractEmailAndName(fromString) {
    const match = fromString.match(/(.*?)<([^>]+)>/);
    if (match) {
        return {
            name: match[1].replace(/["']/g, '').trim(),
            email: match[2].trim().toLowerCase(),
        };
    }
    return {
        name: fromString.trim(),
        email: fromString.trim().toLowerCase(),
    };
}
function extractBodyText(payload) {
    if (!payload)
        return '';
    if (payload.body && payload.body.data) {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.parts && Array.isArray(payload.parts)) {
        for (const part of payload.parts) {
            if (part.mimeType === 'text/plain' && part.body && part.body.data) {
                return Buffer.from(part.body.data, 'base64').toString('utf-8');
            }
        }
        // Fallback to text/html
        for (const part of payload.parts) {
            if (part.mimeType === 'text/html' && part.body && part.body.data) {
                const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
                return html.replace(/<[^>]*>/g, ' '); // simple strip html
            }
        }
    }
    return payload.snippet || '';
}
async function processUnreadEmails() {
    const auth = (0, oauth_js_1.getStoredAuth)();
    if (!auth || !auth.tokens) {
        exports.stats.status = 'not_connected';
        exports.stats.connectedUser = null;
        console.log('[Automation] No Google account connected yet. Awaiting client authorization via /auth/google.');
        return 0;
    }
    exports.stats.connectedUser = auth.userEmail;
    exports.stats.status = 'checking';
    exports.stats.lastChecked = new Date();
    exports.stats.lastError = null;
    let repliedCount = 0;
    try {
        const oauth2Client = (0, oauth_js_1.getOAuth2Client)();
        oauth2Client.setCredentials(auth.tokens);
        oauth2Client.on('tokens', (newTokens) => {
            console.log('[OAuth] Tokens refreshed automatically by Google.');
            (0, oauth_js_1.saveTokens)({ ...auth.tokens, ...newTokens }, auth.userEmail);
        });
        const gmail = googleapis_1.google.gmail({ version: 'v1', auth: oauth2Client });
        // 1. Fetch unread messages
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            q: 'is:unread',
            maxResults: 5,
        });
        const messages = listRes.data.messages || [];
        console.log(`[${new Date().toISOString()}] Found ${messages.length} unread message(s).`);
        const myEmail = auth.userEmail.toLowerCase();
        for (const msg of messages) {
            if (!msg.id)
                continue;
            try {
                const fullMsg = await gmail.users.messages.get({
                    userId: 'me',
                    id: msg.id,
                    format: 'full',
                });
                const headers = fullMsg.data.payload?.headers || [];
                const getHeader = (name) => headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';
                const fromHeader = getHeader('From');
                const subjectHeader = getHeader('Subject') || 'No Subject';
                const messageIdHeader = getHeader('Message-ID');
                const { name: senderName, email: senderEmail } = extractEmailAndName(fromHeader);
                // Filter out emails from myself or no sender
                if (!senderEmail || senderEmail.includes(myEmail) || senderEmail.includes('editcraftstudio19@gmail.com')) {
                    console.log(`[Filter] Skipping email from self: ${senderEmail}`);
                    // Mark as read
                    await gmail.users.messages.modify({
                        userId: 'me',
                        id: msg.id,
                        requestBody: { removeLabelIds: ['UNREAD'] },
                    });
                    continue;
                }
                const bodyText = extractBodyText(fullMsg.data.payload);
                console.log(`[Processing] Email from "${senderName}" <${senderEmail}> - Subject: "${subjectHeader}"`);
                // 2. Generate AI Reply with Gemini
                const aiReply = await (0, ai_js_1.generateEmailReply)(senderEmail, senderName, subjectHeader, bodyText);
                // 3. Send Reply via Gmail API
                const replySubject = subjectHeader.toLowerCase().startsWith('re:') ? subjectHeader : `Re: ${subjectHeader}`;
                const emailLines = [
                    `To: ${senderEmail}`,
                    `Subject: ${replySubject}`,
                    ...(messageIdHeader ? [`In-Reply-To: ${messageIdHeader}`, `References: ${messageIdHeader}`] : []),
                    'Content-Type: text/plain; charset=utf-8',
                    '',
                    aiReply,
                ];
                const rawEmail = emailLines.join('\r\n');
                const encodedEmail = Buffer.from(rawEmail)
                    .toString('base64')
                    .replace(/\+/g, '-')
                    .replace(/\//g, '_')
                    .replace(/=+$/, '');
                await gmail.users.messages.send({
                    userId: 'me',
                    requestBody: {
                        raw: encodedEmail,
                        threadId: fullMsg.data.threadId,
                    },
                });
                console.log(`[Success] Replied to: ${senderEmail}`);
                // 4. Mark as Read in Gmail
                await gmail.users.messages.modify({
                    userId: 'me',
                    id: msg.id,
                    requestBody: { removeLabelIds: ['UNREAD'] },
                });
                repliedCount++;
                exports.stats.emailsProcessed++;
            }
            catch (itemErr) {
                console.error(`[Error] Failed processing message ${msg.id}:`, itemErr.message);
            }
        }
        exports.stats.status = 'idle';
    }
    catch (err) {
        exports.stats.status = 'error';
        exports.stats.lastError = err.message;
        console.error('[Error] Gmail cycle error:', err.message);
    }
    return repliedCount;
}
