const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Database not configured. Check SUPABASE_URL and SUPABASE_SERVICE_KEY in Netlify environment variables.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  // Multi-query support: { queries: [{table, query}, ...] }
  if (body.queries) {
    try {
      const results = await Promise.all(body.queries.map(q => supabaseGet(q.table, q.query || '')));
      return { statusCode: 200, headers: CORS, body: JSON.stringify(results) };
    } catch(err) {
      console.error('Multi-query error:', err.message);
      return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
    }
  }

  const { method, table, query, data, id } = body;
  if (!table) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'table required' }) };

  try {
    let result;
    if (method === 'GET' || !method) {
      result = await supabaseGet(table, query || '');
    } else if (method === 'POST') {
      result = await supabasePost(table, data);
    } else if (method === 'PATCH') {
      result = await supabasePatch(table, id, data);
    } else if (method === 'DELETE') {
      result = await supabaseDelete(table, id);
    } else {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown method: ' + method }) };
    }
    return { statusCode: 200, headers: CORS, body: JSON.stringify(result) };
  } catch (err) {
    console.error('DB error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

async function supabaseGet(table, query) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${table} failed: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function supabasePost(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${table} failed: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function supabasePatch(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PATCH ${table} failed: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : [];
}

async function supabaseDelete(table, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'DELETE',
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`DELETE ${table} failed: ${text.slice(0, 200)}`);
  }
  return [];
}
