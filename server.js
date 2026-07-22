const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;

async function claude(messages, system = "", maxTokens = 2000, model = "claude-sonnet-4-6") {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || 'API error');
  return d.content?.[0]?.text || '';
}

function parseJSON(raw) {
  let s = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.substring(a, b + 1);
  return JSON.parse(s);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ── CHAT (document-aware) ──
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { messages, systemContext } = JSON.parse(body);
        if (!KEY) throw new Error('API key not configured');

        const system = `You are BuildIQ's AI Chief Estimator — 30 years of construction experience. You help contractors with takeoff, measurement, quantities, and bidding.
${systemContext || ''}

When answering questions:
- Be specific and reference the project documents when available
- For measurement questions: tell them which tool (Area/Linear/Count), step by step instructions, what to subtract
- For quantity questions: give exact numbers from the documents when available
- Keep answers clear and actionable
- Use construction terminology correctly`;

        const reply = await claude(messages, system, 1200);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── ANALYZE ONE PAGE ──
  if (req.method === 'POST' && req.url === '/api/analyze-page') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { imageBase64, pageNum, totalPages, projName } = JSON.parse(body);
        if (!KEY) throw new Error('API key not configured');

        const reply = await claude([{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: `This is page ${pageNum} of ${totalPages} of the "${projName}" construction drawing set.

Identify:
1. Sheet type and number (e.g. A1.1 — First Floor Plan)
2. Every room/space with its name and approximate dimensions
3. Every trade scope visible (concrete, steel, MEP, finishes, etc.)
4. All quantities stated on this sheet (count doors, windows, note SF areas, fixture counts, equipment sizes)
5. Any special notes or specifications

Be specific. Read actual labels and dimensions from the drawing. Format clearly with headers.` }
          ]
        }], 'You are BuildIQ AI Chief Estimator analyzing construction drawings. Extract everything useful for a contractor bidding this project.', 1500);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: reply }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── GENERATE MASTER REPORT ──
  if (req.method === 'POST' && req.url === '/api/generate-report') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { pageReports, projName } = JSON.parse(body);
        if (!KEY) throw new Error('API key not configured');

        const combined = pageReports.map(r => `\n\n=== PAGE ${r.page} ===\n${r.content}`).join('');

        const report = await claude([{
          role: 'user',
          content: `Based on these construction drawing analyses for "${projName}", generate a complete Chief Estimator bid report:\n${combined}\n\nFormat with these exact sections:
## PROJECT OVERVIEW
## SCOPE BY TRADE
## QUANTITIES FROM DRAWINGS
## MEASUREMENT GUIDE
## PRE-WRITTEN RFQ EMAILS
## RISK FLAGS & BID STRATEGY`
        }], 'You are BuildIQ AI Chief Estimator producing a complete takeoff report. Be thorough, specific, and reference actual sheet numbers and quantities found in the drawings.', 3000);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ report }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── GENERATE RFQ EMAIL ──
  if (req.method === 'POST' && req.url === '/api/rfq') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { trade, project, due, scope, reportContext } = JSON.parse(body);
        if (!KEY) throw new Error('API key not configured');

        const reply = await claude([{
          role: 'user',
          content: `Write a professional RFQ email:
Trade: ${trade}
Project: ${project}
Bid Due: ${due || 'TBD'}
Scope: ${scope || 'Per drawings and specifications'}
${reportContext ? `\nProject context:\n${reportContext.substring(0, 800)}` : ''}

Make it specific and professional. Under 200 words. Include deadline. Sign as [YOUR NAME] | [YOUR COMPANY] | [YOUR PHONE].`
        }], '', 500, 'claude-haiku-4-5');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ email: reply }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`BuildIQ running on port ${PORT}`));
