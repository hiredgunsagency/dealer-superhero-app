const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return {
      statusCode: 500,
      headers: CORS,
      body: JSON.stringify({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables' })
    };
  }

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ url, key })
  };
};
