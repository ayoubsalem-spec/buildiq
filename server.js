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

  if (req.method === 'POST' && req.url === '/api/full-report') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        if (!API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured on server' }));
          return;
        }

        const { images, projectName } = JSON.parse(body);
        if (!images || !images.length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No page images provided' }));
          return;
        }

        const prompt = 'You are BuildIQ, an AI Chief Estimator. You are given every page of a construction drawing set, in page order (page 1 is first, etc). Read the ENTIRE set before answering.\n\nProduce ONE structured project report. Return ONLY valid JSON in this exact format:\n{\n  "projectInfo": {\n    "projectName": "as shown on cover sheet",\n    "address": "project address",\n    "owner": "owner/client name if shown",\n    "engineeringFirm": "engineer or architect of record",\n    "planApprovalDate": "date if shown",\n    "totalBuildingArea": "SF if stated anywhere in the set",\n    "scopeSummary": "2-3 sentence plain-English summary of what this project is"\n  },\n  "drawingIndex": [\n    {"sheetNumber": "A-1", "pageInSet": 1, "title": "Cover Sheet", "category": "General", "keyNotes": "what this sheet shows and why it matters for estimating", "estimatingImpact": "HIGH/MEDIUM/LOW/NONE"}\n  ],\n  "scopeByTrade": [\n    {"csiDivision": "03 - Concrete", "whatIsShown": "summary of concrete scope across the set", "keySheets": ["list of sheet numbers with relevant detail"]}\n  ],\n  "statedQuantities": [\n    {"item": "name of quantity", "value": "value as stated", "sourceSheet": "sheet number"}\n  ],\n  "warnings": ["conflicts, missing info, or risks noticed across the set"]\n}\n\nBe thorough on drawingIndex -- include every sheet you were given, in order. Keep keyNotes to 1-2 sentences per sheet.';

        const content = images.map(img => ({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: img }
        }));
        content.push({ type: 'text', text: prompt });

        const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 16000,
            messages: [{ role: 'user', content: content }]
          })
        });

        const data = await apiResp.json();
        if (!apiResp.ok) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'API error: ' + JSON.stringify(data) }));
          return;
        }

        if (data.stop_reason === 'max_tokens') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Report was cut off before finishing (hit the token limit). Try a smaller drawing set or raise max_tokens further.'
          }));
          return;
        }

        let raw = data.content[0].text.trim();
        raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          raw = raw.substring(jsonStart, jsonEnd + 1);
        }
        let result;
        try { result = JSON.parse(raw); }
        catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error: ' + e.message, raw: raw.substring(0, 300) }));
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
          prompt = 'You are BuildIQ, an expert AI construction estimator. The user clicked inside a room on this construction drawing (' + width + 'x' + height + ' pixels).\n\nIdentify the SPECIFIC room the click landed in and give GPS-style step by step measurement instructions.\n\nCRITICAL: Also report a tight bounding box around ONLY that one room -- not the whole drawing, not neighboring rooms. Give it as fractions of the full image width/height (0.0 to 1.0), measured from the top-left corner. This box must hug just the walls of the identified room so a preview overlay can highlight the correct area.\n\nReturn ONLY valid JSON in this exact format:\n{\n  "roomName": "Room name as labeled on drawing",\n  "roomType": "type of room",\n  "tool": "area",\n  "toolInstruction": "SELECT THE AREA TOOL - click Area in the toolbar",\n  "whyThisTool": "Why we use this tool for this measurement",\n  "dimensions": "dimensions if visible on drawing",\n  "boundingBox": {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0},\n  "steps": [\n    {"stepNumber": 1, "action": "Click SW corner - START HERE", "detail": "Click the bottom-left inside corner", "direction": "START HERE"},\n    {"stepNumber": 2, "action": "Click NW corner", "detail": "Move UP along the west wall and click top-left corner", "direction": "GO NORTH"},\n    {"stepNumber": 3, "action": "Click NE corner", "detail": "Move RIGHT along the north wall and click top-right corner", "direction": "GO EAST"},\n    {"stepNumber": 4, "action": "Click SE corner", "detail": "Move DOWN along the east wall and click bottom-right corner", "direction": "GO SOUTH"},\n    {"stepNumber": 5, "action": "Double-click to close", "detail": "Double-click near your starting point to close the shape", "direction": "CLOSE SHAPE"}\n  ],\n  "doorsToSubtract": [],\n  "windowsToSubtract": [],\n  "warnings": ["any notes about this room"]\n}';
        }

        // Fullsheet scans return a long checklist (every room/measurement/count on
        // the sheet) and can run past 2000 tokens, which was truncating the JSON
        // mid-response and causing "Unexpected end of JSON input". Single-room
        // clicks return a short, fixed-shape object, so they stay lower.
        const maxTokens = mode === 'fullsheet' ? 8000 : 2000;

        const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: maxTokens,
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

        // If Claude's reply got cut off by hitting max_tokens, stop_reason will say
        // so explicitly -- catch that here with a clear message instead of letting
        // it fail later as a confusing JSON parse error.
        if (data.stop_reason === 'max_tokens') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'Response was cut off before finishing (hit the token limit). Try increasing max_tokens further, or simplify the request.'
          }));
          return;
        }

        let raw = data.content[0].text.trim();
        // Strip any markdown code fences
        raw = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
        // Extract just the JSON object if there's surrounding text
        const jsonStart = raw.indexOf('{');
        const jsonEnd = raw.lastIndexOf('}');
        if (jsonStart !== -1 && jsonEnd !== -1) {
          raw = raw.substring(jsonStart, jsonEnd + 1);
        }
        let result;
        try { result = JSON.parse(raw); }
        catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error: ' + e.message, raw: raw.substring(0, 300) }));
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
