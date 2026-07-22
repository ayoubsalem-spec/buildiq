const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;

async function claude(messages, system, maxTokens, model) {
  model = model || 'claude-sonnet-4-6';
  maxTokens = maxTokens || 2000;
  system = system || '';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ? d.error.message : 'API error');
  return d.content && d.content[0] ? d.content[0].text : '';
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), function(err, data) {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  function readBody(req, cb) {
    let body = '';
    req.on('data', function(c) { body += c.toString(); });
    req.on('end', function() { cb(body); });
  }

  // ── CHAT ──
  if (req.method === 'POST' && req.url === '/api/chat') {
    readBody(req, async function(body) {
      try {
        const parsed = JSON.parse(body);
        const messages = parsed.messages;
        const systemContext = parsed.systemContext || '';
        if (!KEY) throw new Error('API key not configured on server');

        const system = 'You are Klyro, BuildIQ\'s AI Chief Estimator with 30 years of commercial construction experience. You help contractors win bids through expert takeoff, measurement guidance, and project analysis.\n\n' + systemContext + '\n\nWhen answering:\n- Reference specific sheet numbers from the project context when available\n- For measurement questions: specify tool (Area/Linear/Count), which sheet, calibration dimension, step by step instructions, what to subtract\n- Give exact quantities from drawings when available\n- Be specific and actionable\n- Use correct construction terminology';

        const reply = await claude(messages, system, 1200);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply: reply }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── ANALYZE ONE PAGE ──
  if (req.method === 'POST' && req.url === '/api/analyze-page') {
    readBody(req, async function(body) {
      try {
        const parsed = JSON.parse(body);
        const imageBase64 = parsed.imageBase64;
        const pageNum = parsed.pageNum;
        const totalPages = parsed.totalPages;
        const projName = parsed.projName;
        if (!KEY) throw new Error('API key not configured on server');

        const userPrompt = 'You are Klyro, AI Chief Estimator. This is page ' + pageNum + ' of ' + totalPages + ' of the "' + projName + '" construction drawing set.\n\nREAD THIS DRAWING CAREFULLY and extract everything a contractor needs to bid this project.\n\n1. SHEET ID: Sheet number and title exactly as printed (e.g. "A-1.1 - First Floor Architectural Plan")\n2. SHEET TYPE: floor plan / elevation / site plan / structural / mechanical / electrical / plumbing / detail / schedule\n3. ROOMS & SPACES: Every room label you can read with any dimensions shown\n4. STATED QUANTITIES: Every number written on this sheet - read the actual numbers:\n   - Door counts, window counts from schedules\n   - Square footage areas called out\n   - Equipment sizes (tons, KW, gallons, amps)\n   - Pipe and duct sizes\n   - Structural member sizes and counts\n   - Parking counts, occupant loads\n   - Any other numbers stated\n5. TRADE SCOPE: Every trade visible - concrete, steel, MEP, finishes, site work, etc.\n6. SCHEDULES: If sheet has door/window/room finish/equipment schedule - read every single entry\n7. NOTES: All general notes, specifications, special requirements\n8. KEY DIMENSIONS: Overall building dimensions, heights, critical measurements\n\nBe thorough. Read actual text. Reference this sheet number for everything you report.';

        const reply = await claude([{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: userPrompt }
          ]
        }], 'You are Klyro, AI Chief Estimator with 30 years of construction experience. Extract every detail a contractor needs to bid this project accurately.', 1500);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ content: reply }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── GENERATE MASTER REPORT ──
  if (req.method === 'POST' && req.url === '/api/generate-report') {
    readBody(req, async function(body) {
      try {
        const parsed = JSON.parse(body);
        const pageReports = parsed.pageReports;
        const projName = parsed.projName;
        if (!KEY) throw new Error('API key not configured on server');

        const combined = pageReports.map(function(r) {
          return '\n\n=== PAGE ' + r.page + ' ===\n' + r.content;
        }).join('');

        const userPrompt = 'Based on these construction drawing analyses for "' + projName + '", generate a COMPLETE Chief Estimator bid report.\n\nPAGE ANALYSES:\n' + combined + '\n\nProduce the report using EXACTLY this structure:\n\n## 1. PROJECT OVERVIEW\nExtract and state: project name and address, project type, building size SF (state which sheet), number of floors, construction type, occupancy classification, special conditions (sprinkler/fire alarm/ADA), permit status, engineer of record, critical notes.\n\n## 2. SCOPE BY TRADE\nFor EVERY trade identified list:\n**[TRADE NAME]**\n- Scope: [exactly what drawings show]\n- Found on: [exact sheet number and name]\n- Key notes: [critical info for sub]\n- Complexity: Simple / Medium / Complex\n\nTrades: Site Work, Concrete, Structural Steel/Metal Building, Masonry/Brick, Rough Carpentry, Roofing, Waterproofing, Doors/Hardware, Windows/Glazing, Drywall & Ceilings, Flooring, Painting, Specialties, Mechanical/HVAC, Plumbing, Electrical, Fire Sprinkler, Fire Alarm, Landscaping, Paving\n\n## 3. STATED QUANTITIES\nONLY numbers explicitly written on drawings:\n| Item | Quantity | Unit | Found On |\nInclude: building SF, parking count, occupant load, door count, window count, room areas, equipment sizes, electrical service, pipe sizes, any noted quantity.\n\n## 4. MEASUREMENT GUIDE\nFor every item requiring manual measurement:\n**[ITEM TO MEASURE]**\n- Why you need it: [trade and purpose]\n- Open sheet: [exact sheet number and name]\n- Calibrate using: [exact labeled dimension on that sheet]\n- Verify with: [second dimension to confirm]\n- Tool: [Area / Linear / Count]\n- Steps: [numbered click-by-click instructions]\n- Estimate: [intelligent SF/LF estimate as sanity check]\n- Time: [X minutes]\n\n## 5. PRE-WRITTEN RFQ EMAILS\nFor EVERY trade requiring a sub - complete ready-to-send email with specific scope items from the drawings, exact sheet references, project details.\n\nFormat:\nSubject: RFQ - [Trade] | [Project Name] | Bid Due [DATE]\n\nHi [Sub Name],\nWe are bidding [Project] at [address] and need your number.\nScope: [specific from drawings]\nKey drawings: [sheets]\nItems to include:\n- [from drawings]\nProject: [size, type, permit status]\nBid due: [FILL IN] | Need quote by: [FILL IN]\n[YOUR NAME] | [YOUR COMPANY] | [YOUR PHONE]\n\n## 6. RISK FLAGS\nEvery item that could blow the budget:\n** [RISK]**\n- Found on: [sheet]\n- Why it is a risk: [specific explanation]\n- What to do: [protective action]\n\n## 7. BID STRATEGY\n- Project type and typical bidders\n- Most critical scopes to price competitively\n- Opportunities to sharpen the number\n- Qualifications and exclusions to include\n- Questions to ask before submitting\n- Single most important thing to get right\n\nNEVER make up quantities. Always cite exact sheet numbers. Write every RFQ email specific to THIS project. Goal: help this contractor WIN the bid.';

        const report = await claude([{
          role: 'user',
          content: userPrompt
        }], 'You are Klyro, AI Chief Estimator with 30 years of commercial construction experience. You read construction drawings and produce complete takeoff reports. You are specific, actionable, and reference exact drawing sheets. Your goal: help contractors win bids.', 4000);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ report: report }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── GENERATE RFQ EMAIL ──
  if (req.method === 'POST' && req.url === '/api/rfq') {
    readBody(req, async function(body) {
      try {
        const parsed = JSON.parse(body);
        const trade = parsed.trade;
        const project = parsed.project;
        const due = parsed.due || 'TBD';
        const scope = parsed.scope || 'Per drawings and specifications';
        const reportContext = parsed.reportContext || '';
        if (!KEY) throw new Error('API key not configured on server');

        const userPrompt = 'Write a professional RFQ email:\nTrade: ' + trade + '\nProject: ' + project + '\nBid Due: ' + due + '\nScope: ' + scope + (reportContext ? '\n\nProject context:\n' + reportContext.substring(0, 800) : '') + '\n\nMake it specific and professional. Under 200 words. Include deadline. Sign as [YOUR NAME] | [YOUR COMPANY] | [YOUR PHONE].';

        const reply = await claude([{ role: 'user', content: userPrompt }], '', 500, 'claude-haiku-4-5');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ email: reply }));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, function() {
  console.log('BuildIQ running on port ' + PORT);
});
