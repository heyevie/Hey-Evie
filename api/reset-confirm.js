// api/reset-confirm.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Parse body manually in case it comes in as a string
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch(e) { body = {}; }
  }

  const token    = body && body.token;
  const password = body && body.password;

  if (!token || !password) return res.status(400).json({ error: 'Token and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const airtableToken = process.env.AIRTABLE_TOKEN;
  const BASE_ID       = 'appZtgVfaI0Xlkqau';
  const TABLE_ID      = 'tblS1ezJBCcfPOttZ';

  try {
    const formula  = encodeURIComponent('{reset_token}="' + token + '"');
    const checkRes = await fetch(
      'https://api.airtable.com/v0/' + BASE_ID + '/' + TABLE_ID + '?filterByFormula=' + formula + '&maxRecords=1',
      { headers: { 'Authorization': 'Bearer ' + airtableToken } }
    );
    const checkData = await checkRes.json();

    console.log('Reset confirm: token lookup records=', checkData.records ? checkData.records.length : 0);

    if (!checkData.records || checkData.records.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const record = checkData.records[0];
    const expiry = record.fields && record.fields.reset_expiry;
    if (!expiry || new Date(expiry) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.' });
    }

    await fetch(
      'https://api.airtable.com/v0/' + BASE_ID + '/' + TABLE_ID + '/' + record.id,
      {
        method: 'PATCH',
        headers: { 'Authorization': 'Bearer ' + airtableToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: { password: password, reset_token: '', reset_expiry: '' } })
      }
    );

    console.log('Reset confirm: password updated for', record.fields.email);
    return res.status(200).json({ success: true, email: record.fields.email });

  } catch (err) {
    console.error('Reset confirm error:', err.message);
    return res.status(500).json({ error: 'Something went wrong' });
  }
}
