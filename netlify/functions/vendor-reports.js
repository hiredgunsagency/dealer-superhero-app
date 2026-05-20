const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Invalid request body' }) }; }

  const { action } = body;

  try {
    if (action === 'get-upload-url') {
      return await getUploadUrl(body);
    } else if (action === 'extract') {
      return await extractReport(body);
    } else {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Unknown action' }) };
    }
  } catch (err) {
    console.error('vendor-reports error:', err.message);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

// Generate a signed upload URL for the frontend to upload directly to Supabase Storage
async function getUploadUrl(body) {
  const { fileName, dealerId, vendorId, month, year } = body;
  if (!fileName || !dealerId) throw new Error('fileName and dealerId required');

  const path = `${dealerId}/${vendorId || 'general'}/${year}-${String(month).padStart(2,'0')}-${Date.now()}-${fileName}`;

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/vendor-reports/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ upsert: false }),
  });

  // Return the path so frontend can upload and reference it
  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ path, uploadUrl: `${SUPABASE_URL}/storage/v1/object/vendor-reports/${path}` }),
  };
}

// Extract text from uploaded file and run Claude analysis
async function extractReport(body) {
  const { filePath, fileName, dealerId, vendorId, vendorName, vendorCategory, month, year, vendorPromises } = body;
  if (!filePath || !dealerId) throw new Error('filePath and dealerId required');

  // Download the file from Supabase Storage
  const fileRes = await fetch(`${SUPABASE_URL}/storage/v1/object/vendor-reports/${filePath}`, {
    headers: { 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!fileRes.ok) throw new Error('Failed to download file from storage');

  const fileBuffer = await fileRes.arrayBuffer();
  const base64Data = Buffer.from(fileBuffer).toString('base64');
  const contentType = fileRes.headers.get('content-type') || 'application/pdf';

  // Determine if PDF or text-based
  const isPDF = contentType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
  const isExcel = fileName.toLowerCase().match(/\.(xlsx|xls|csv)$/);

  let rawText = '';

  if (isPDF) {
    // Use Claude's document reading capability
    const extractRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: base64Data }
            },
            {
              type: 'text',
              text: 'Extract all text content from this document. Return the raw text as-is, preserving numbers, percentages, dates, and metric values. Do not summarize — extract everything.'
            }
          ]
        }]
      }),
    });
    if (!extractRes.ok) throw new Error('Failed to extract PDF text');
    const extractData = await extractRes.json();
    rawText = (extractData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  } else {
    // For CSV/Excel treat as text
    rawText = Buffer.from(fileBuffer).toString('utf-8').slice(0, 50000);
  }

  if (!rawText) throw new Error('Could not extract text from file');

  // Now analyze with Claude to extract claimed metrics
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const monthName = monthNames[(month || 1) - 1];

  const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are analyzing a vendor report for a car dealership. Extract all claimed metrics and performance data.

VENDOR: ${vendorName || 'Unknown'} (${vendorCategory || 'Unknown category'})
REPORT PERIOD: ${monthName} ${year}
${vendorPromises ? `VENDOR PROMISES ON FILE: ${vendorPromises}` : ''}

REPORT CONTENT:
${rawText.slice(0, 15000)}

Return ONLY valid JSON:
{
  "reportSummary": "<2-3 sentence summary of what this report claims>",
  "claimedMetrics": [
    { "metric": "<metric name>", "value": "<value>", "context": "<brief context>" }
  ],
  "keyHighlights": ["<highlight 1>", "<highlight 2>"],
  "redFlags": ["<anything that looks concerning or vague>"],
  "promiseComparison": "<if vendor promises were provided, compare claims to promises in 2-3 sentences. Otherwise say no promises on file.>",
  "verdict": "<delivering|mixed|unclear|underdelivering>",
  "verdictReason": "<one sentence explaining the verdict>"
}`
      }]
    }),
  });

  if (!analysisRes.ok) throw new Error('AI analysis failed');
  const analysisData = await analysisRes.json();
  const analysisText = (analysisData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');

  let claims = {};
  try {
    let clean = analysisText.replace(/```json\s*/gi,'').replace(/```/g,'').trim();
    const first = clean.indexOf('{'), last = clean.lastIndexOf('}');
    if (first !== -1 && last !== -1) claims = JSON.parse(clean.slice(first, last+1));
  } catch(e) {
    claims = { reportSummary: 'Could not parse analysis', claimedMetrics: [], keyHighlights: [], redFlags: [] };
  }

  // Save to vendor_reports table
  const saveRes = await fetch(`${SUPABASE_URL}/rest/v1/vendor_reports`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify({
      dealer_id: dealerId,
      vendor_id: vendorId || null,
      report_month: parseInt(month) || new Date().getMonth() + 1,
      report_year: parseInt(year) || new Date().getFullYear(),
      file_url: filePath,
      file_name: fileName,
      extracted_claims: claims,
      raw_text: rawText.slice(0, 10000),
      uploaded_at: new Date().toISOString(),
    }),
  });

  if (!saveRes.ok) throw new Error('Failed to save report record');
  const saved = await saveRes.json();

  return {
    statusCode: 200,
    headers: CORS,
    body: JSON.stringify({ success: true, reportId: saved[0]?.id, claims }),
  };
}
