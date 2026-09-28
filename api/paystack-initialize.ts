export const maxDuration = 30;

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
    const { amount, planKey, packageId, type, userId, email: userEmail } = body;

    // Server-side authoritative price resolution
    let resolvedAmountNgn: number | null = null;

    if (packageId) {
      if (packageId === 'live_tutorial_15' || packageId === 'live_tutorial_pass') resolvedAmountNgn = 299;
      else if (packageId === 'live_tutorial_30' || packageId === 'live_tutorial_30_pass') resolvedAmountNgn = 599;
      else if (packageId === 'live_tutorial_60' || packageId === 'live_tutorial_60_pass') resolvedAmountNgn = 1099;
    }

    if (!resolvedAmountNgn && planKey) {
      const key = (planKey || '').toLowerCase();
      if (key === 'pro' || key === 'monthly' || key === 'premium') resolvedAmountNgn = 3999;
      else if (key === 'weekly' || key === 'basic') resolvedAmountNgn = 1499;
      else if (key === 'semester') resolvedAmountNgn = 11999;
    }

    // Fallback if client provided amount for custom refills
    const finalAmountNgn = resolvedAmountNgn ?? Number(amount);

    if (!finalAmountNgn || finalAmountNgn < 100) {
      return new Response(
        JSON.stringify({ error: 'Invalid amount or package ID. Minimum is ₦100.' }),
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

    const host = req.headers.get('host') || 'www.avelut.xyz';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const callback_url = `${protocol}://${host}/payment-success`;

    const email = userEmail || `${userId || 'student'}@avelut.com`;
    const payload = {
      email,
      amount: Math.round(finalAmountNgn * 100), // Paystack uses kobo
      callback_url,
      metadata: {
        custom_fields: [
          { display_name: 'User ID', variable_name: 'user_id', value: userId },
          { display_name: 'Purchase Type', variable_name: 'purchase_type', value: type },
          { display_name: 'Plan Key', variable_name: 'plan_key', value: planKey || 'none' },
          { display_name: 'Package ID', variable_name: 'package_id', value: packageId || 'none' },
        ],
      },
    };

    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const json = await response.json();

    if (!json.status) {
      return new Response(
        JSON.stringify({ error: json.message || 'Failed to initialize payment with provider' }),
        { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    return new Response(
      JSON.stringify({
        authorization_url: json.data.authorization_url,
        reference: json.data.reference,
        access_code: json.data.access_code,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message || 'Error connecting to payment provider' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
