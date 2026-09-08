import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export type VercelRequest = IncomingMessage & {
  body: any;
  query: { [key: string]: string | string[] };
  cookies: { [key: string]: string };
  method?: string;
};

export type VercelResponse = ServerResponse & {
  send: (body: any) => VercelResponse;
  json: (jsonBody: any) => VercelResponse;
  status: (statusCode: number) => VercelResponse;
};

export const config = {
  api: {
    bodyParser: false,
  },
};

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5d3Brc2FwenR6Ym50aGxnZmhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjc5MzYsImV4cCI6MjEwMzYwMzkzNn0.uLZ-LBLWBmcgZYHnSDkbMV-BJA26I9x-pGDTZZxzyPI';
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function getRawBody(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

/**
 * Paystack Webhook Handler for Vercel
 * Endpoint: POST /api/paystack-webhook
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET_KEY) {
    console.error('PAYSTACK_SECRET_KEY is not configured in environment variables.');
    return res.status(500).json({ error: 'Gateway Configuration Error' });
  }

  let rawBuffer: Buffer;
  try {
    rawBuffer = await getRawBody(req);
  } catch (err) {
    console.error('Error reading request stream:', err);
    return res.status(400).json({ error: 'Error reading request body' });
  }

  try {
    const hash = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(rawBuffer).digest('hex');
    const signatureHeader = Array.isArray(req.headers['x-paystack-signature'])
      ? req.headers['x-paystack-signature'][0]
      : req.headers['x-paystack-signature'];

    if (!signatureHeader || hash !== signatureHeader) {
      console.warn('Invalid Paystack signature on webhook request');
      return res.status(401).json({ error: 'Unauthorized signature' });
    }
  } catch (sigErr) {
    console.error('Error verifying webhook signature:', sigErr);
    return res.status(400).json({ error: 'Bad signature verification request' });
  }

  let event: any;
  try {
    event = JSON.parse(rawBuffer.toString('utf-8'));
  } catch (jsonErr) {
    console.error('Error parsing JSON event payload:', jsonErr);
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  if (event?.event === 'charge.success') {
    const data = event.data || {};
    const reference = data.reference;
    const metadata = data.metadata || {};
    const customFields = Array.isArray(metadata.custom_fields) ? metadata.custom_fields : [];

    const uidField = customFields.find((f: any) => f?.variable_name === 'user_id');
    const typeField = customFields.find((f: any) => f?.variable_name === 'purchase_type');
    const planField = customFields.find((f: any) => f?.variable_name === 'plan_key');

    const uid = uidField?.value || metadata.user_id || metadata.userId;
    const purchaseType = typeField?.value || metadata.purchase_type || metadata.purchaseType;
    const planKey = planField?.value || metadata.plan_key || metadata.planKey;
    const verifiedAmountKobo = Number(data.amount);
    const verifiedAmountNgn = Number.isFinite(verifiedAmountKobo) ? Math.round(verifiedAmountKobo) / 100 : 0;

    if (!uid) {
      console.error('Paystack webhook charge.success missing user_id in metadata');
      return res.status(200).send('OK');
    }

    try {
      if (purchaseType === 'subscription') {
        await supabaseAdmin.from('profiles').update({
          is_paid_subscriber: true,
          updated_at: new Date().toISOString(),
        }).eq('id', uid);

        await supabaseAdmin.from('subscriptions').upsert({
          user_id: uid,
          plan_type: planKey || 'monthly',
          status: 'active',
          paystack_reference: reference,
          starts_at: new Date().toISOString(),
        });
      } else {
        const creditMap: Record<number, number> = {
          500: 500,
          1000: 1100,
          2000: 2400,
          5000: 6500,
        };
        const creditsToAdd = creditMap[verifiedAmountNgn] || Math.round(verifiedAmountNgn);

        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('ai_credits')
          .eq('id', uid)
          .maybeSingle();

        const currentCredits = profile?.ai_credits || 0;
        await supabaseAdmin.from('profiles').update({
          ai_credits: currentCredits + creditsToAdd,
          updated_at: new Date().toISOString(),
        }).eq('id', uid);
      }

      console.log('Successfully processed Paystack webhook for user:', uid, 'ref:', reference);
    } catch (dbErr) {
      console.error('Error updating Supabase from Vercel Webhook:', dbErr);
      return res.status(500).json({ error: 'Database update failed' });
    }
  }

  return res.status(200).send('OK');
}
