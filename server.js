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

        const system = `You are Klyro, BuildIQ's AI Chief Estimator with 30 years of commercial construction experience. You help contractors win bids through expert takeoff, measurement guidance, and project analysis.

${systemContext || ''}

When answering questions about the project:
- Reference specific sheet numbers and drawing details from the project context above
- Give exact quantities and numbers when available from the drawings
- For measurement questions: specify which tool (Area/Linear/Count), which sheet to open, exact calibration dimension to use, step by step what to click and trace, what to subtract
- For scope questions: reference the specific trades, sheets, and notes you found in the drawings
- For quantity questions: distinguish between stated quantities (already on drawings) and quantities that need to be measured
- Be specific and actionable — a contractor should be able to act immediately on your answer
- Use correct construction terminology
- If asked something not in the project documents, answer from your 30 years of construction knowledge`;

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
            { type: 'text', text: `You are Klyro, AI Chief Estimator. This is page ${pageNum} of ${totalPages} of the "${projName}" construction drawing set.

READ THIS DRAWING CAREFULLY and extract everything a contractor needs to bid this project.

1. SHEET ID: Sheet number and title exactly as printed (e.g. "A-1.1 — First Floor Architectural Plan")
2. SHEET TYPE: floor plan / elevation / site plan / structural / mechanical / electrical / plumbing / detail / schedule
3. ROOMS & SPACES: Every room label you can read with any dimensions shown
4. STATED QUANTITIES: Every number written on this sheet — read the actual numbers:
   - Door counts, window counts from schedules
   - Square footage areas called out
   - Equipment sizes (tons, KW, gallons, amps)
   - Pipe and duct sizes
   - Structural member sizes and counts
   - Parking counts, occupant loads
   - Any other numbers stated
5. TRADE SCOPE: Every trade visible — concrete, steel, MEP, finishes, site work, etc.
6. SCHEDULES: If sheet has door/window/room finish/equipment schedule — read every single entry
7. NOTES: All general notes, specifications, special requirements
8. KEY DIMENSIONS: Overall building dimensions, heights, critical measurements

Be thorough. Read actual text. Reference this sheet number for everything you report.` }
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
      content: `Based on these construction drawing analyses for "${projName}", generate a COMPLETE Chief Estimator bid report.

PAGE ANALYSES:
${combined}

Produce the report using EXACTLY this structure:

## 📋 1. PROJECT OVERVIEW
Extract and state: project name and address, project type (new/renovation/addition), building size SF (state which sheet), number of floors, construction type, occupancy classification, special conditions (sprinkler/fire alarm/ADA), permit status, engineer of record, critical notes.

## 🏗️ 2. SCOPE BY TRADE
For EVERY trade identified list:
**[TRADE NAME]**
- Scope: [exactly what drawings show]
- Found on: [exact sheet number and name]
- Key notes: [critical info for sub]
- Complexity: Simple / Medium / Complex

Trades to check: Site Work, Concrete & Foundation, Structural Steel/Metal Building, Masonry/Brick, Rough Carpentry, Roofing, Waterproofing, Doors/Frames/Hardware, Windows/Glazing, Drywall & Ceilings, Flooring, Painting, Specialties, Mechanical/HVAC, Plumbing, Electrical, Fire Sprinkler, Fire Alarm, Landscaping, Paving

## 📐 3. STATED QUANTITIES
ONLY numbers explicitly written on drawings — never calculated:
| Item | Quantity | Unit | Found On |
Include: building SF, parking count, occupant load, door count, window count, room areas, equipment sizes, electrical service, pipe sizes, structural schedules, any noted quantity.

## 📏 4. MEASUREMENT GUIDE
For every item requiring manual measurement — give PRECISE Bluebeam instructions:
**[ITEM TO MEASURE]**
- Why you need it: [trade and purpose]
- Open sheet: [exact sheet number and name]
- Calibrate using: [exact labeled dimension visible on that specific sheet]
- Verify with: [second dimension to confirm calibration is correct]
- Tool: [Area / Linear / Count]
- Steps: [numbered click-by-click instructions]
- Estimate: [intelligent SF/LF estimate based on building size as sanity check]
- Time: [X minutes]

## 📧 5. PRE-WRITTEN RFQ EMAILS
For EVERY trade requiring a sub — complete ready-to-send email:

**[TRADE] RFQ EMAIL:**
Subject: RFQ — [Trade] | [Project Name] | Bid Due [DATE]

Hi [Sub Name],

We are bidding [Project Name] at [address] and would like your number.

Scope: [specific scope from drawings]
Key drawings: [exact sheet references]
Specific items to include:
- [item 1 from drawings]
- [item 2 from drawings]
- [item 3 from drawings]
Project details: [building size, type, permit status]
Our bid due: [FILL IN] | Need your quote by: [FILL IN — 2 days before]

Please confirm receipt. Call [YOUR NUMBER] with questions.
[YOUR NAME] | [YOUR COMPANY] | [YOUR PHONE]

## 🚩 6. RISK FLAGS
Every item that could blow the budget:
⚠️ **[RISK]**
- Found on: [sheet]
- Why it's a risk: [specific explanation]
- What to do: [specific protective action]

## 🏆 7. BID STRATEGY
- Project type and typical bidders
- Most critical scopes to price competitively
- Opportunities to sharpen the number
- Qualifications and exclusions to include
- Questions to ask before submitting
- Single most important thing to get right

RULES: Never make up quantities. Always cite exact sheet numbers. Write every RFQ email specific to THIS project. Your goal: help this contractor WIN the bid.`
    }], 'You are Klyro, an AI Chief Estimator with 30 years of commercial construction experience. You read construction drawings and produce complete takeoff reports. You are specific, actionable, and reference exact drawing sheets for everything. Your goal is to help contractors win bids.', 4000);tp = require('http');
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

        const system = `You are Klyro, BuildIQ's AI Chief Estimator with 30 years of commercial construction experience. You help contractors win bids through expert takeoff, measurement guidance, and project analysis.

${systemContext || ''}

When answering questions about the project:
- Reference specific sheet numbers and drawing details from the project context above
- Give exact quantities and numbers when available from the drawings
- For measurement questions: specify which tool (Area/Linear/Count), which sheet to open, exact calibration dimension to use, step by step what to click and trace, what to subtract
- For scope questions: reference the specific trades, sheets, and notes you found in the drawings
- For quantity questions: distinguish between stated quantities (already on drawings) and quantities that need to be measured
- Be specific and actionable — a contractor should be able to act immediately on your answer
- Use correct construction terminology
- If asked something not in the project documents, answer from your 30 years of construction knowledge`;

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
