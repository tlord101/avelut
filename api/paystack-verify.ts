import { createClient } from '@supabase/supabase-js';

export const maxDuration = 30;

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://eywpksapztzbnthlgfhd.supabase.co';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5d3Brc2FwenR6Ym50aGxnZmhkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgwMjc5MzYsImV4cCI6MjEwMzYwMzkzNn0.uLZ-LBLWBmcgZYHnSDkbMV-BJA26I9x-pGDTZZxzyPI';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
    },
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { reference, userId } = body;

    if (!reference) {
      return new Response(
        JSON.stringify({ error: 'Transaction reference is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    if (!PAYSTACK_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: 'PAYSTACK_SECRET_KEY is not configured on the server' }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    });

    const json = await response.json();

    if (!json.status || json.data.status !== 'success') {
      return new Response(
        JSON.stringify({ error: json.data?.gateway_response || 'Payment verification failed' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    const data = json.data;
    const metadata = data.metadata || {};
    const customFields = metadata.custom_fields || [];
    
    const uidField = customFields.find((f: any) => f.variable_name === 'user_id');
    const typeField = customFields.find((f: any) => f.variable_name === 'purchase_type');
    const planField = customFields.find((f: any) => f.variable_name === 'plan_key');
    const packageField = customFields.find((f: any) => f.variable_name === 'package_id');

    const targetUserId = userId || uidField?.value;
    const purchaseType = typeField?.value || 'refill';
    const planKey = planField?.value;
    const packageId = packageField?.value;
    const amountNgn = data.amount / 100;

    if (targetUserId) {
      if (purchaseType === 'subscription') {
        const canonicalPlan = (planKey || 'pro').toLowerCase();
        const effectivePlan = canonicalPlan === 'pro' ? 'monthly' : canonicalPlan;

        await supabaseAdmin.from('profiles').update({
          is_paid_subscriber: true,
          subscription_status: effectivePlan,
          updated_at: new Date().toISOString(),
        }).eq('id', targetUserId);

        await supabaseAdmin.from('subscriptions').upsert({
          user_id: targetUserId,
          plan_type: effectivePlan,
          status: 'active',
          paystack_reference: reference,
          starts_at: new Date().toISOString(),
        });
      } else {
        let creditsToAdd = Math.round(amountNgn);
        if (packageId === 'live_tutorial_15') creditsToAdd = 299;
        else if (packageId === 'live_tutorial_30') creditsToAdd = 599;
        else if (packageId === 'live_tutorial_60') creditsToAdd = 1099;

        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('ai_credits')
          .eq('id', targetUserId)
          .maybeSingle();

        const currentCredits = profile?.ai_credits || 0;
        await supabaseAdmin.from('profiles').update({
          ai_credits: currentCredits + creditsToAdd,
          updated_at: new Date().toISOString(),
        }).eq('id', targetUserId);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Payment verified and applied successfully',
        data: {
          reference,
          amount: amountNgn,
          status: data.status,
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Error during payment verification' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
