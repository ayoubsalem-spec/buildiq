const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error loading app'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        if (!API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server' }));
          return;
        }

        const { imageBase64, width, height, mode } = JSON.parse(body);

        let prompt = '';
        if (mode === 'fullsheet') {
          prompt = 'You are BuildIQ, an expert AI construction estimator. Analyze this full construction drawing sheet (' + width + 'x' + height + ' pixels).\n\nScan the ENTIRE drawing. Identify every room, area, and item that needs to be measured for a construction takeoff.\n\nReturn ONLY valid JSON in this exact format:\n{\n  "sheetType": "floor_plan",\n  "sheetDescription": "First floor plan showing all rooms",\n  "measurementChecklist": [\n    {"id": 1, "name": "Building Footprint", "tool": "area", "priority": "HIGH", "why": "Drives slab, roofing, overall size", "instruction": "Trace entire outer perimeter", "estimatedSF": "estimated SF if visible"},\n    {"id": 2, "name": "Main Hall", "tool": "area", "priority": "HIGH", "why": "Largest space - drives flooring and HVAC", "instruction": "Trace interior of main hall", "estimatedSF": ""}\n  ],\n  "linearMeasurements": [\n    {"id": 1, "name": "Building Perimeter", "tool": "linear", "priority": "HIGH", "why": "Grade beam linear footage", "instruction": "Trace outer building perimeter"}\n  ],\n  "countsNeeded": [\n    {"name": "Doors", "tool": "count", "why": "Door count drives hardware scope", "instruction": "Click each door symbol"}\n  ],\n  "statedQuantities": [\n    {"item": "Total Building Area", "value": "value if shown", "source": "where found on drawing"}\n  ],\n  "warnings": ["any important notes or risks seen on this drawing"]\n}';
        } else {
          prompt = 'You are BuildIQ, an expert AI construction estimator. The user clicked inside a room on this construction drawing (' + width + 'x' + height + ' pixels).\n\nIdentify the room and give GPS-style step by step measurement instructions.\n\nReturn ONLY valid JSON in this exact format:\n{\n  "roomName": "Room name as labeled on drawing",\n  "roomType": "type of room",\n  "tool": "area",\n  "toolInstruction": "SELECT THE AREA TOOL - click Area in the toolbar",\n  "whyThisTool": "Why we use this tool for this measurement",\n  "dimensions": "dimensions if visible on drawing",\n  "steps": [\n    {"stepNumber": 1, "action": "Click SW corner - START HERE", "detail": "Click the bottom-left inside corner", "direction": "START HERE"},\n    {"stepNumber": 2, "action": "Click NW corner", "detail": "Move UP along the west wall and click top-left corner", "direction": "GO NORTH"},\n    {"stepNumber": 3, "action": "Click NE corner", "detail": "Move RIGHT along the north wall and click top-right corner", "direction": "GO EAST"},\n    {"stepNumber": 4, "action": "Click SE corner", "detail": "Move DOWN along the east wall and click bottom-right corner", "direction": "GO SOUTH"},\n    {"stepNumber": 5, "action": "Double-click to close", "detail": "Double-click near your starting point to close the shape", "direction": "CLOSE SHAPE"}\n  ],\n  "doorsToSubtract": [],\n  "windowsToSubtract": [],\n  "warnings": ["any notes about this room"]\n}';
        }

        const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
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

        const data = await apiResp.json();
        if (!apiResp.ok) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'API error: ' + JSON.stringify(data) }));
          return;
        }

        const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
        let result;
        try { result = JSON.parse(raw); }
        catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error', raw: raw.substring(0, 200) }));
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

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('BuildIQ running on port ' + PORT);
});
