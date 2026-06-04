// /api/airtable.js
// Secure Airtable proxy - keeps your token on the server, never in the browser

export default async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email required' });
  }

  const token = process.env.AIRTABLE_TOKEN;
  const baseId = 'appZtgVfaI0Xlkqau';
  const tableId = 'tblS1ezJBCcfPOttZ';

  if (!token) {
    // Token not configured - return starter access
    return res.status(200).json({ plan: 'starter', status: 'active', name: '' });
  }

  try {
    const formula = encodeURIComponent(`LOWER({email})=LOWER("${email.trim()}")`);
    const url = `https://api.airtable.com/v0/${baseId}/${tableId}?filterByFormula=${formula}&maxRecords=1`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Airtable error: ${response.status}`);
    }

    const data = await response.json();

    if (data.records && data.records.length > 0) {
      const fields = data.records[0].fields;
      return res.status(200).json({
        plan:   fields.plan   || 'starter',
        status: fields.status || 'active',
        name:   fields.name   || ''
      });
    }

    // Email not found - free starter access
    return res.status(200).json({ plan: 'starter', status: 'active', name: '' });

  } catch (err) {
    console.error('Airtable lookup error:', err);
    // Fail open with starter access so app still works if Airtable is down
    return res.status(200).json({ plan: 'starter', status: 'active', name: '' });
  }
}
