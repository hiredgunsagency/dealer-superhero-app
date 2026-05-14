// generate-report-background.js
// Netlify Background Function — runs async, no timeout limit
// Saves result directly to Supabase when complete

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

exports.handler = async (event) => {
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return; }

  const { dealer_id, report_month, report_year, job_id } = body;
  if (!dealer_id || !job_id) return;

  const month = report_month || new Date().getMonth() + 1;
  const year = report_year || new Date().getFullYear();

  // Mark job as processing
  await sbPatch(`monthly_reports?job_id=eq.${job_id}`, { job_status: 'processing' });

  try {
    // Pull all dealer data
    const [dealerRes, vendorsRes, competitorsRes, salesRes, vendorLeadsRes] = await Promise.all([
      sbGet(`dealers?id=eq.${dealer_id}`),
      sbGet(`vendors?dealer_id=eq.${dealer_id}&status=eq.active`),
      sbGet(`competitors?dealer_id=eq.${dealer_id}&order=display_order.asc`),
      sbGet(`sales_data?dealer_id=eq.${dealer_id}&sale_month=eq.${month}&sale_year=eq.${year}`),
      sbGet(`vendor_leads?dealer_id=eq.${dealer_id}&attribution_month=eq.${month}&attribution_year=eq.${year}&select=*,vendors(vendor_name,monthly_fee,category)`),
    ]);

    const dealer = dealerRes[0];
    if (!dealer) throw new Error('Dealer not found');

    const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long' });

    // Build vendor context
    const vendorContext = vendorsRes.length > 0
      ? vendorsRes.map(v => {
          const promises = [];
          if (v.promised_traffic_increase) promises.push(`traffic increase: ${v.promised_traffic_increase}%`);
          if (v.promised_cost_per_lead) promises.push(`CPL: $${v.promised_cost_per_lead}`);
          if (v.promised_roas) promises.push(`ROAS: ${v.promised_roas}x`);
          if (v.promised_review_response_hours) promises.push(`review response: ${v.promised_review_response_hours}hrs`);
          if (v.promised_deliverables) promises.push(v.promised_deliverables);
          if (v.additional_promises) promises.push(v.additional_promises);
          return `- ${v.vendor_name} (${v.category || 'General'}, $${v.monthly_fee || 0}/mo): Promised: ${promises.length ? promises.join(', ') : 'No promises recorded'}`;
        }).join('\n')
      : 'No vendors recorded yet';

    const competitorContext = competitorsRes.length > 0
      ? competitorsRes.map(c => `- ${c.name} (Priority ${c.display_order}): ${c.website_url || 'no URL'} ${c.notes ? '| Notes: ' + c.notes : ''}`).join('\n')
      : 'No competitors recorded yet';

    // Build sales context
    const salesData = salesRes[0];
    const salesContext = salesData
      ? `ACTUAL SALES DATA FOR THIS MONTH:
- Total Vehicles Sold: ${salesData.total_vehicles_sold}
- Total Leads Received: ${salesData.total_leads}
- Total Appointments Set: ${salesData.total_appointments}
- Lead-to-Sale Rate: ${salesData.total_leads ? Math.round((salesData.total_vehicles_sold/salesData.total_leads)*100) : 'N/A'}%
- Lead-to-Appointment Rate: ${salesData.total_leads && salesData.total_appointments ? Math.round((salesData.total_appointments/salesData.total_leads)*100) : 'N/A'}%
- Leads from Paid Search: ${salesData.leads_from_paid_search || 0}
- Leads from Organic/SEO: ${salesData.leads_from_organic || 0}
- Leads from Third-Party: ${salesData.leads_from_third_party || 0}
- Leads from Phone: ${salesData.leads_from_phone || 0}
- Leads from Walk-In: ${salesData.leads_from_walkin || 0}`
      : 'No sales data entered for this month yet.';

    const vendorROIContext = vendorLeadsRes.length > 0
      ? `VENDOR ROI DATA:\n` + vendorLeadsRes.map(vl => {
          const fee = parseFloat(vl.vendors?.monthly_fee || 0);
          const cpcs = vl.vehicles_sold > 0 ? Math.round(fee / vl.vehicles_sold) : null;
          const cpl = vl.leads_generated > 0 ? Math.round(fee / vl.leads_generated) : null;
          let verdict = 'unknown';
          if (cpcs !== null) {
            if (cpcs < 300) verdict = 'strong ROI';
            else if (cpcs < 600) verdict = 'acceptable';
            else if (cpcs < 1000) verdict = 'weak ROI';
            else verdict = 'not justified';
          }
          return `- ${vl.vendors?.vendor_name}: $${fee}/mo fee, ${vl.leads_generated} leads, ${vl.vehicles_sold} cars sold, CPL: ${cpl ? '$'+cpl : 'N/A'}, Cost/Car Sold: ${cpcs ? '$'+cpcs.toLocaleString() : 'N/A'} → ${verdict}`;
        }).join('\n')
      : 'No vendor attribution data entered for this month.';

    const system = `You are Shaun Raines, a 30-year automotive industry veteran and trusted independent advisor to car dealers. You are NOT a consultant — you are a truth-teller who gives dealers the unvarnished reality of their digital performance. You have no vendor affiliations and nothing to sell.

You are generating a monthly intelligence report for one of your dealer clients. Your tone is direct, confident, and specific. You know this dealer's market, their competitors, and exactly where they stand.

Return ONLY valid JSON — no markdown, no explanation.

JSON structure:
{
  "overallScore": <0-100>,
  "grade": "<A|B|C|D|F>",
  "executiveSummary": "<3-4 sentences. Open by proving you know their business — name the dealer, their brand, their market. Then state their overall position clearly and honestly. Mention their strongest asset and their biggest vulnerability.>",
  "competitivePosition": {
    "summary": "<2-3 sentences about where this dealer stands vs their competitors>",
    "competitors": [
      {
        "name": "<competitor name>",
        "priority": "<Primary|Secondary|Third>",
        "whereTheyAreWinning": ["<specific area where competitor has advantage>"],
        "whereYouAreWinning": ["<specific area where dealer has advantage>"],
        "urgency": "<high|medium|low>"
      }
    ]
  },
  "channels": [
    {
      "name": "<channel name>",
      "score": <0-100>,
      "grade": "<A|B|C|D|F>",
      "summary": "<1-2 specific sentences about performance in this channel>",
      "findings": [
        { "status": "<pass|warn|fail>", "text": "<specific finding>" }
      ]
    }
  ],
  "vendorAccountability": [
    {
      "vendorName": "<name>",
      "category": "<category>",
      "monthlyFee": <fee or 0>,
      "verdict": "<delivering|mixed|underdelivering|unknown>",
      "summary": "<1-2 sentences about whether they are delivering on their promises>",
      "findings": [
        { "status": "<pass|warn|fail>", "text": "<specific finding vs their stated promise>" }
      ]
    }
  ],
  "salesROI": {
    "hasData": <true|false>,
    "totalVendorSpend": <total monthly vendor spend>,
    "totalVehiclesSold": <number or null>,
    "totalLeads": <number or null>,
    "leadToSaleRate": <percentage or null>,
    "blendedCostPerCarSold": <dollar amount or null>,
    "summary": "<2-3 sentences connecting digital marketing investments to actual car sales. Be direct about what the numbers show.>",
    "vendorROI": [
      {
        "vendorName": "<name>",
        "monthlyFee": <fee>,
        "leadsGenerated": <number or null>,
        "carsSold": <number or null>,
        "costPerLead": <dollar or null>,
        "costPerCarSold": <dollar or null>,
        "verdict": "<strong-roi|acceptable|weak-roi|not-justified|unknown>",
        "verdictReason": "<one sentence explaining the verdict>"
      }
    ]
  },
  "actionPlan": [
    {
      "priority": "<high|medium|low>",
      "effort": "<quick-win|medium-lift|heavy-lift>",
      "investment": "<time|money|both>",
      "investmentDetail": "<specific detail — e.g. 2-3 hours/week from your marketing coordinator or Budget $500-800/mo>",
      "owner": "<dealer|vendor|both>",
      "title": "<short action title>",
      "description": "<2-3 sentences: what to do, why it matters right now, what result to expect>",
      "impact": "<specific measurable expected outcome>"
    }
  ],
  "channelScores": {
    "seo": <0-100>,
    "paidSearch": <0-100>,
    "website": <0-100>,
    "reputation": <0-100>,
    "social": <0-100>,
    "emailCrm": <0-100>,
    "aiVisibility": <0-100>,
    "vendorAccountability": <0-100>
  }
}

Channels to cover: SEO, Paid Search, Website Experience, Reputation & Reviews, Social Media, Email & CRM, AI Visibility.
Action plan: 4-5 items ordered by priority. Be specific — never say varies.
Vendor accountability: cover every vendor listed. Be concise.
Grades: A=85-100, B=70-84, C=55-69, D=40-54, F=0-39.
Keep findings to 3 per category maximum. Keep descriptions under 2 sentences. Be direct and specific.`;

    const userMsg = `Generate the ${monthName} ${year} intelligence report for:

DEALER: ${dealer.name}
BRAND: ${dealer.brand || 'Unknown'}
LOCATION: ${[dealer.city, dealer.state].filter(Boolean).join(', ') || 'Unknown'}
WEBSITE: ${dealer.website_url || 'Not provided'}
CMS: ${dealer.cms_provider || 'Unknown'}

VENDORS BEING PAID:
${vendorContext}

COMPETITORS TO ANALYZE:
${competitorContext}

${salesContext}

${vendorROIContext}

Use web search to:
1. Research ${dealer.name}'s current online presence — SEO rankings, reviews, GBP activity, social media, website quality
2. Research each competitor's online presence for direct comparison
3. Find any recent changes — new reviews, ranking shifts, ad activity, website updates
4. Assess how ${dealer.name} appears in AI-powered searches (Claude, ChatGPT, Gemini, Google AI Overviews)
5. Check vendor category benchmarks — what should a ${dealer.brand || 'auto'} dealer's vendors be delivering?

Be specific. Reference real data. Do not be generous with scores.`;

    // Call Anthropic with web search — no timeout pressure
    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 5500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system,
        messages: [{ role: 'user', content: userMsg }],
      }),
    });

    if (!aiRes.ok) {
      const t = await aiRes.text();
      throw new Error(`Anthropic error ${aiRes.status}: ${t.slice(0, 300)}`);
    }

    const aiData = await aiRes.json();
    const text = (aiData.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    if (!text) throw new Error('No response from AI');

    let clean = text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
    const first = clean.indexOf('{');
    const last = clean.lastIndexOf('}');
    if (first === -1 || last === -1) throw new Error('No JSON in AI response');
    clean = clean.slice(first, last + 1);

    let report;
    try {
      report = JSON.parse(clean);
    } catch(parseErr) {
      // JSON was likely truncated — try to recover by closing open structures
      console.warn('JSON parse failed, attempting repair. Error:', parseErr.message);
      try {
        let repaired = clean;
        // Count unclosed braces and brackets
        let braces = 0, brackets = 0, inStr = false, escape = false;
        for (const ch of repaired) {
          if (escape) { escape = false; continue; }
          if (ch === '\\' && inStr) { escape = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === '{') braces++;
          else if (ch === '}') braces--;
          else if (ch === '[') brackets++;
          else if (ch === ']') brackets--;
        }
        // Remove trailing incomplete string/value
        repaired = repaired.replace(/,\s*$/, '').replace(/:\s*$/, ':null');
        // Close open arrays and objects
        while (brackets > 0) { repaired += ']'; brackets--; }
        while (braces > 0) { repaired += '}'; braces--; }
        report = JSON.parse(repaired);
        console.log('JSON repair succeeded');
      } catch(repairErr) {
        throw new Error('Failed to parse AI response — JSON truncated. Try regenerating. Original error: ' + parseErr.message);
      }
    }

    // Save completed report to Supabase
    await sbPatch(`monthly_reports?job_id=eq.${job_id}`, {
      job_status: 'complete',
      overall_score: report.overallScore,
      seo_score: report.channelScores?.seo,
      paid_search_score: report.channelScores?.paidSearch,
      website_score: report.channelScores?.website,
      reputation_score: report.channelScores?.reputation,
      social_score: report.channelScores?.social,
      email_crm_score: report.channelScores?.emailCrm,
      ai_visibility_score: report.channelScores?.aiVisibility,
      vendor_accountability_score: report.channelScores?.vendorAccountability,
      key_findings: report.channels,
      recommended_actions: report.actionPlan,
      vendor_accountability_summary: report.vendorAccountability,
      report_data: { ...report, dealer, month, year, monthName },
      status: 'draft',
    });

  } catch (err) {
    console.error('Background report error:', err);
    await sbPatch(`monthly_reports?job_id=eq.${job_id}`, {
      job_status: 'failed',
      error_message: err.message,
    });
  }
};

async function sbGet(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  if (!res.ok) throw new Error(`Supabase error: ${await res.text()}`);
  return res.json();
}

async function sbPatch(path, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase patch error: ${await res.text()}`);
  return res.json();
}

async function sbPost(table, data) {
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
  if (!res.ok) throw new Error(`Supabase post error: ${await res.text()}`);
  return res.json();
}
