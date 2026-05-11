const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { method, table, query, data, id } = body;

  if (!table) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'table required' }) };

  try {
    let url = `${SUPABASE_URL}/rest/v1/${table}${query || ''}`;
    let fetchOptions = {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      }
    };

    if (method === 'GET' || !method) {
      fetchOptions.method = 'GET';
    } else if (method === 'POST') {
      fetchOptions.method = 'POST';
      fetchOptions.headers['Prefer'] = 'return=representation';
      fetchOptions.body = JSON.stringify(data);
    } else if (method === 'PATCH') {
      url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
      fetchOptions.method = 'PATCH';
      fetchOptions.headers['Prefer'] = 'return=representation';
      fetchOptions.body = JSON.stringify(data);
    } else if (method === 'DELETE') {
      url = `${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`;
      fetchOptions.method = 'DELETE';
    }

    const res = await fetch(url, fetchOptions);
    const text = await res.text();

    if (!res.ok) return { statusCode: res.status, headers: CORS, body: JSON.stringify({ error: text }) };

    const result = text ? JSON.parse(text) : [];
    return { statusCode: 200, headers: CORS, body: JSON.stringify(result) };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
