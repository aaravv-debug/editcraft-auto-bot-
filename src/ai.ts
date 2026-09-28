import { GoogleGenerativeAI } from '@google/generative-ai';

const SYSTEM_INSTRUCTION = `You are an assistant that writes professional email replies on behalf of Aaravsinh Rathod, founder of EditCraftStudio. Output ONLY the reply email text, ready to send as-is. No summary, no analysis, no subject line, no placeholders or brackets, no preamble like "here is the reply". Include his portfolio link https://aaravsinh-rathod-portfolio-9.vercel.app/ naturally in the reply when relevant. Sign off as Aaravsinh Rathod.

When the sender asks about pricing, cost, rates, charges, packages, or quotes, include the relevant prices from this official EditCraftStudio price list in the reply (prices in INR, mention they are estimates and the final quote depends on project scope):

Website Development:
- Basic: single-page landing page, basic SEO, contact form - Rs 15,000
- Pro: up to 5 pages, advanced SEO, blog setup, analytics - Rs 35,000
- Custom: e-commerce/custom web app, full integrations - Rs 75,000

Automation Bot:
- Basic: simple task automation, single platform integration - Rs 10,000
- Pro: multi-platform workflow, error handling, scheduling - Rs 25,000
- Custom: complex AI integrations, custom API endpoints - Rs 50,000

Only share the tiers relevant to what the sender asked about, present them in a clean readable list, and offer a call/meeting to discuss their exact requirements.`;

const CANDIDATE_MODELS = ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash-lite'];

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateEmailReply(senderEmail: string, senderName: string, subject: string, bodyText: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is missing.');
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  const prompt = `I want to draft an email in a very professional way. Keep in mind that I am open for freelancing services and open for meetings in a very professional manner.
Sender: ${senderName} <${senderEmail}>
Subject: ${subject}
Email Content:
"""
${bodyText}
"""

Please draft the reply answering any questions asked in the email. My name is Aaravsinh Rathod.`;

  let lastError: any = null;

  for (let attempt = 1; attempt <= 4; attempt++) {
    for (const modelName of CANDIDATE_MODELS) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: SYSTEM_INSTRUCTION,
        });

        const result = await model.generateContent(prompt);
        const replyText = result.response.text()?.trim();
        if (replyText) {
          return replyText;
        }
      } catch (err: any) {
        lastError = err;
        // If 503 high demand spike, brief wait and try next candidate
        if (err.status === 503) {
          continue;
        }
      }
    }
    const backoffMs = attempt * 2000;
    console.log(`[AI] Google servers busy (503). Retrying in ${backoffMs / 1000}s... (Attempt ${attempt}/4)`);
    await sleep(backoffMs);
  }

  throw new Error(`Failed to generate AI reply after retries: ${lastError?.message || 'Server busy'}`);
}
