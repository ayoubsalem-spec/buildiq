const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/analyze-room') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { imageBase64, width, height, mode } = JSON.parse(body);

        if (!ANTHROPIC_API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not set on server' }));
          return;
        }

        let prompt;

        if (mode === 'room') {
          prompt = 'You are BuildIQ, an expert AI construction estimator. You are looking at a construction floor plan drawing (' + width + 'x' + height + ' pixels).\n\nIdentify the room or area visible and give GPS-style step by step measurement instructions.\n\nRespond with ONLY this JSON format, no other text:\n{\n  "roomName": "Main Hall",\n  "roomType": "assembly",\n  "tool": "area",\n  "toolInstruction": "SELECT THE AREA TOOL - click the Area button in the toolbar",\n  "whyThisTool": "We use Area tool to get square footage for flooring and ceiling calculations",\n  "dimensions": "approximately 66\'-10\\" x 50\'-0\\" based on dimensions shown",\n  "tracePath": "Trace the interior face of all walls starting from bottom-left corner clockwise",\n  "steps": [\n    { "stepNumber": 1, "action": "Click SW corner - START HERE", "detail": "Click the bottom-left inside corner where the south wall meets the west wall", "direction": "START HERE" },\n    { "stepNumber": 2, "action": "Click NW corner", "detail": "Move NORTH along the west wall and click the top-left corner", "direction": "GO NORTH" },\n    { "stepNumber": 3, "action": "Click NE corner", "detail": "Move EAST along the north wall and click the top-right corner", "direction": "GO EAST" },\n    { "stepNumber": 4, "action": "Click SE corner", "detail": "Move SOUTH along the east wall and click the bottom-right corner", "direction": "GO SOUTH" },\n    { "stepNumber": 5, "action": "Double-click to close", "detail": "Double-click near your starting SW corner to close the shape", "direction": "CLOSE SHAPE" }\n  ],\n  "doorsToSubtract": [],\n  "windowsToSubtract": [],\n  "calculations": { "grossArea": "estimated from dimensions shown", "netDrywall": "gross area minus door and window deductions" },\n  "warnings": ["Verify dimensions against drawing notes"],\n  "nextRoom": "Measure the next room"\n}\n\nRules:\n- Read actual room labels from the drawing if visible\n- Use real dimensions from the drawing if shown\n- Identify door symbols (arc + line) and list them in doorsToSubtract\n- Return ONLY the JSON, no markdown, no explanation';
        }

        if (mode === 'fullsheet') {
          prompt = 'You are BuildIQ, an expert AI construction estimator. You are looking at a full construction drawing sheet (' + width + 'x' + height + ' pixels).\n\nScan the ENTIRE drawing and identify EVERY area that needs to be measured for a complete construction takeoff.\n\nRespond with ONLY this JSON format:\n{\n  "sheetType": "floor_plan",\n  "sheetDescription": "First floor architectural plan showing all rooms and spaces",\n  "totalItems": 12,\n  "measurementChecklist": [\n    { "id": 1, "name": "Building Footprint", "type": "area", "tool": "area", "priority": "HIGH", "why": "Drives concrete slab, roofing, and overall project size", "instruction": "Trace entire outer building perimeter", "estimatedSF": "7652 SF per cover sheet" },\n    { "id": 2, "name": "Main Hall", "type": "area", "tool": "area", "priority": "HIGH", "why": "Largest space - drives flooring, ceiling, and HVAC quantities", "instruction": "Trace interior perimeter of main hall", "estimatedSF": "approximately 3330 SF" }\n  ],\n  "linearMeasurements": [\n    { "id": 1, "name": "Building Perimeter", "tool": "linear", "priority": "HIGH", "why": "Grade beam and exterior wall linear footage", "instruction": "Trace outer building perimeter with linear tool" }\n  ],\n  "countsNeeded": [\n    { "name": "Doors", "tool": "count", "why": "Door count drives hardware and framing scope", "instruction": "Click each door symbol on the plan" }\n  ],\n  "statedQuantities": [\n    { "item": "Total Building Area", "value": "7652 SF", "source": "Title block or cover sheet" }\n  ],\n  "warnings": [\n    "Stage has 100 PSF live load - verify with structural",\n    "Fire sprinkler room requires separate permit"\n  ]\n}\n\nIdentify EVERY room, every wall measurement, every count needed. Be thorough. Return ONLY the JSON.';
        }

        const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
                { type: 'text', text: prompt }
              ]
            }]
          })
        });

        const data = await apiResponse.json();

        if (!apiResponse.ok) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Anthropic API error: ' + JSON.stringify(data) }));
          return;
        }

        const rawText = data.content[0].text.trim();
        let result;
        try {
          result = JSON.parse(rawText.replace(/```json|```/g, '').trim());
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error', raw: rawText.substring(0, 300) }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));

      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log('BuildIQ running on port ' + PORT));
