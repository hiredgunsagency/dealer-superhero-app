const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const job_id = event.queryStringParameters?.job_id;
  if (!job_id) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'job_id required' }) };

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/monthly_reports?job_id=eq.${job_id}&select=job_status,report_data,error_message,overall_score`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });

    if (!res.ok) throw new Error(await res.text());
    const rows = await res.json();
    const row = rows[0];

    if (!row) return { statusCode: 404, headers: CORS, body: JSON.stringify({ status: 'not_found' }) };

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        status: row.job_status,
        report: row.job_status === 'complete' ? row.report_data : null,
        error: row.error_message || null,
      }),
    };
  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
