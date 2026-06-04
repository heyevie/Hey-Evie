// /api/webhook.js
// Stripe webhook - automatically adds members to Airtable when they pay

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const airtableToken = process.env.AIRTABLE_TOKEN;

  const BASE_ID  = 'appZtgVfaI0Xlkqau';
  const TABLE_ID = 'tblS1ezJBCcfPOttZ';

  // Monthly plan price ID
  const MONTHLY_PRICE = 'price_1TeLsGBFWXHVzahYI1lSFXmp';
  // VIP plan price ID
  const VIP_PRICE     = 'price_1TeLsXBFWXHVzahY9zPKHZSG';

  let event;

  // Verify the webhook came from Stripe
  if (webhookSecret) {
    try {
      const rawBody = await getRawBody(req);
      const stripe = await import('stripe');
      const stripeClient = stripe.default(process.env.STRIPE_SECRET_KEY);
      event = stripeClient.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return res.status(400).json({ error: 'Invalid signature' });
    }
  } else {
    // No webhook secret set yet - accept the event (for initial testing)
    event = req.body;
  }

  const type = event.type;

  // ── New checkout completed ──
  if (type === 'checkout.session.completed') {
    const session = event.data.object;
    const email   = session.customer_details?.email || session.customer_email;
    const name    = session.customer_details?.name  || '';
    const custId  = session.customer || '';

    // Determine plan from line items or amount
    const amount  = session.amount_total;
    const plan    = amount >= 19700 ? 'vip' : 'starter';

    if (email) {
      await upsertMember(airtableToken, BASE_ID, TABLE_ID, {
        email:     email.toLowerCase().trim(),
        name:      name,
        plan:      plan,
        status:    'active',
        stripe_id: custId,
        joined:    new Date().toISOString().split('T')[0]
      });
      console.log(`Member added: ${email} as ${plan}`);
    }
  }

  // ── Payment intent succeeded (backup catch) ──
  if (type === 'payment_intent.succeeded') {
    const pi     = event.data.object;
    const email  = pi.receipt_email || pi.metadata?.email;
    const amount = pi.amount;

    if (email) {
      const plan = amount >= 19700 ? 'vip' : 'starter';
      await upsertMember(airtableToken, BASE_ID, TABLE_ID, {
        email:     email.toLowerCase().trim(),
        name:      pi.metadata?.name || '',
        plan:      plan,
        status:    'active',
        stripe_id: pi.customer || '',
        joined:    new Date().toISOString().split('T')[0]
      });
    }
  }

  // ── Subscription cancelled ──
  if (type === 'customer.subscription.deleted') {
    const sub    = event.data.object;
    const custId = sub.customer;

    // Look up email from Stripe customer ID in Airtable
    await updateMemberStatus(airtableToken, BASE_ID, TABLE_ID, custId, 'cancelled');
    console.log(`Member cancelled: customer ${custId}`);
  }

  // ── Subscription reactivated ──
  if (type === 'customer.subscription.updated') {
    const sub    = event.data.object;
    const status = sub.status;
    const custId = sub.customer;

    if (status === 'active') {
      await updateMemberStatus(airtableToken, BASE_ID, TABLE_ID, custId, 'active');
    } else if (status === 'past_due' || status === 'unpaid') {
      await updateMemberStatus(airtableToken, BASE_ID, TABLE_ID, custId, 'paused');
    }
  }

  return res.status(200).json({ received: true });
}

// ── Helper: add or update member in Airtable ──
async function upsertMember(token, baseId, tableId, member) {
  if (!token) return;

  try {
    // Check if email already exists
    const formula  = encodeURIComponent(`LOWER({email})=LOWER("${member.email}")`);
    const checkUrl = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${formula}&maxRecords=1`;

    const checkRes  = await fetch(checkUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const checkData = await checkRes.json();

    const fields = {
      email:     member.email,
      name:      member.name,
      plan:      member.plan,
      status:    member.status,
      stripe_id: member.stripe_id,
      joined:    member.joined
    };

    if (checkData.records && checkData.records.length > 0) {
      // Update existing record
      const recordId = checkData.records[0].id;
      await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`, {
        method:  'PATCH',
        headers: {
          'Authorization':  `Bearer ${token}`,
          'Content-Type':   'application/json'
        },
        body: JSON.stringify({ fields })
      });
    } else {
      // Create new record
      await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}`, {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ fields: [{ fields }] })
      });
    }
  } catch (err) {
    console.error('Airtable upsert error:', err);
  }
}

// ── Helper: update member status by Stripe customer ID ──
async function updateMemberStatus(token, baseId, tableId, stripeId, status) {
  if (!token || !stripeId) return;

  try {
    const formula  = encodeURIComponent(`{stripe_id}="${stripeId}"`);
    const checkUrl = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${formula}&maxRecords=1`;

    const checkRes  = await fetch(checkUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const checkData = await checkRes.json();

    if (checkData.records && checkData.records.length > 0) {
      const recordId = checkData.records[0].id;
      await fetch(`https://api.airtable.com/v0/${baseId}/${tableId}/${recordId}`, {
        method:  'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type':  'application/json'
        },
        body: JSON.stringify({ fields: { status } })
      });
    }
  } catch (err) {
    console.error('Airtable status update error:', err);
  }
}

// ── Helper: read raw body for Stripe signature verification ──
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end',  ()    => resolve(data));
    req.on('error', reject);
  });
}
