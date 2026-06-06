// api/airtable.js
// Checks membership status AND handles password set/get

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, setPassword } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  const token   = process.env.AIRTABLE_TOKEN;
  const BASE_ID = 'appZtgVfaI0Xlkqau';
  const TABLE   = 'tblS1ezJBCcfPOttZ';

  try {
    const formula  = encodeURIComponent('LOWER({email})=LOWER("' + email.trim() + '")');
    const checkRes = await fetch(
      'https://api.airtable.com/v0/' + BASE_ID + '/' + TABLE + '?filterByFormula=' + formula + '&maxRecords=1',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    const data = await checkRes.json();

    if (!data.records || data.records.length === 0) {
      return res.status(200).json({ plan: 'starter', status: 'active', name: '', password: '' });
    }

    const record = data.records[0];
    const fields = record.fields || {};

    // If setPassword provided, update it in Airtable
    if (setPassword) {
      await fetch(
        'https://api.airtable.com/v0/' + BASE_ID + '/' + TABLE + '/' + record.id,
        {
          method: 'PATCH',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: { password: setPassword } })
        }
      );
    }

    return res.status(200).json({
      plan:     fields.plan     || 'starter',
      status:   fields.status   || 'active',
      name:     fields.name     || '',
      password: fields.password || ''
    });

  } catch (err) {
    console.error('Airtable error:', err.message);
    return res.status(200).json({ plan: 'starter', status: 'active', name: '', password: '' });
  }
}
