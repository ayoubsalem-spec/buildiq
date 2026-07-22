const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;

function readBody(req, cb) {
  let body = '';
  req.on('data', function(c) { body += c.toString(); });
  req.on('end', function() { cb(body); });
}

async function callClaude(messages, system, maxTokens, model) {
  model = model || 'claude-sonnet-4-6';
  maxTokens = maxTokens || 2000;
  system = system || '';
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: model, max_tokens: maxTokens, system: system, messages: messages })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error ? d.error.message : 'API error');
  return d.content && d.content[0] ? d.content[0].text : '';
}

function parseJSON(raw) {
  var s = raw.replace(/```json/g, '').replace(/```/g, '').trim();
  var a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) s = s.substring(a, b + 1);
  return JSON.parse(s);
}

const server = http.createServer(async function(req, res) {
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

  // ── SCAN ROOMS — fast full-page scan, returns room list + GPS steps ──
  if (req.method === 'POST' && req.url === '/api/scan-rooms') {
    readBody(req, async function(body) {
      try {
        const parsed = JSON.parse(body);
        const imageBase64 = parsed.imageBase64;
        const width = parsed.width || 1200;
        const height = parsed.height || 900;
        const pageNum = parsed.pageNum || 1;
        const totalPages = parsed.totalPages || 1;
        if (!KEY) throw new Error('ANTHROPIC_API_KEY not set on server');

        const prompt = 'You are BuildIQ, an expert AI construction estimator with 30 years experience reading construction drawings.\n\nYou are analyzing page ' + pageNum + ' of ' + totalPages + ' of a construction drawing set.\nImage dimensions: ' + width + ' x ' + height + ' pixels.\n\nREAD THIS DRAWING COMPLETELY and identify EVERY room, space, and area visible.\n\nFor EACH room or space you find:\n1. Read the EXACT room label text as printed on the drawing\n2. Read ALL dimension numbers shown (like 17\'-0", 20\'-0", 66\'-10")\n3. Identify the approximate pixel boundaries of that room on this image\n4. Find every door symbol (line + arc = door swing) in or bordering that room\n5. Find every window symbol (parallel lines in wall) in that room\n6. Determine what tool to use: area for rooms/floors, linear for walls/beams, count for items\n\nDOOR SYMBOLS: A straight line showing door width + a quarter-circle arc showing swing direction\nWINDOW SYMBOLS: Two parallel lines that break through a wall line\nDIMENSIONS: Numbers between tick marks or arrows showing distances\n\nReturn ONLY this exact JSON format:\n{\n  "pageType": "floor_plan",\n  "pageDescription": "First floor architectural plan",\n  "rooms": [\n    {\n      "id": "room_1",\n      "name": "WOMEN RESTROOM",\n      "type": "restroom",\n      "width": "13\'-6\\"",\n      "height": "17\'-0\\"",\n      "pixelBounds": { "x": 850, "y": 420, "w": 180, "h": 240, "centerX": 940, "centerY": 540 },\n      "tool": "area",\n      "measurementPurpose": "Flooring, wall tile, ceiling, plumbing layout",\n      "gpsSteps": [\n        { "step": 1, "action": "Click SW corner", "detail": "Click bottom-left inside corner where south wall meets west wall", "direction": "START HERE" },\n        { "step": 2, "action": "Click NW corner", "detail": "Move NORTH along west wall 17\'-0\\" and click top-left corner", "direction": "GO NORTH 17\'-0\\"" },\n        { "step": 3, "action": "Click NE corner", "detail": "Move EAST along north wall and click top-right corner", "direction": "GO EAST" },\n        { "step": 4, "action": "Click SE corner", "detail": "Move SOUTH along east wall and click bottom-right corner", "direction": "GO SOUTH" },\n        { "step": 5, "action": "Double-click to close", "detail": "Double-click near starting point to close shape and calculate area", "direction": "CLOSE SHAPE" }\n      ],\n      "doors": [{ "id": "D5", "width": "2\'-8\\"", "location": "south wall", "subtractSF": 18.7 }],\n      "windows": [],\n      "calculations": {\n        "grossArea": "229 SF (13\'-6\\" x 17\'-0\\")",\n        "doorDeductions": "18.7 SF",\n        "netWallArea": "210 SF",\n        "netFloorArea": "229 SF"\n      },\n      "warnings": ["Moisture resistant drywall required"]\n    }\n  ],\n  "linearItems": [\n    {\n      "id": "linear_1",\n      "name": "Building Perimeter",\n      "tool": "linear",\n      "gpsSteps": [\n        { "step": 1, "action": "Start at any corner", "detail": "Click any outside corner of the building", "direction": "START" },\n        { "step": 2, "action": "Trace full perimeter", "detail": "Click each corner clockwise around the building exterior", "direction": "GO CLOCKWISE" }\n      ]\n    }\n  ],\n  "countItems": [\n    {\n      "id": "count_1",\n      "name": "Interior Doors",\n      "tool": "count",\n      "estimatedCount": 31,\n      "gpsSteps": [\n        { "step": 1, "action": "Select COUNT tool", "detail": "Click Count button in toolbar", "direction": "SELECT TOOL" },\n        { "step": 2, "action": "Click each door", "detail": "Click once on each door arc symbol throughout the plan", "direction": "CLICK EACH DOOR" }\n      ]\n    }\n  ],\n  "statedQuantities": [\n    { "item": "Total Building Area", "value": "7,652 SF", "foundOn": "Title block" }\n  ],\n  "warnings": ["Stage has 100 PSF live load", "Fire sprinkler is separate permit"]\n}\n\nCRITICAL RULES:\n- pixelBounds must be accurate - this is how users click on rooms\n- centerX and centerY must be INSIDE the room\n- Read EVERY room label exactly as printed\n- Include EVERY room visible - do not skip any\n- GPS steps must reference actual dimensions shown on the drawing\n- Return ONLY the JSON object, nothing else';

        const raw = await callClaude([{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }], 'You are BuildIQ AI Chief Estimator. Return only valid JSON as instructed.', 4000);

        let result;
        try { result = parseJSON(raw); }
        catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error: ' + e.message, raw: raw.substring(0, 300) }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch(e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── ROOM GPS — deep analysis of a single room crop ──
  if (req.method === 'POST' && req.url === '/api/room-gps') {
    readBody(req, async function(body) {
      try {
        const parsed = JSON.parse(body);
        const imageBase64 = parsed.imageBase64;
        const roomName = parsed.roomName || 'this room';
        const width = parsed.width || 400;
        const height = parsed.height || 400;
        if (!KEY) throw new Error('ANTHROPIC_API_KEY not set on server');

        const prompt = 'You are BuildIQ AI Chief Estimator. You are looking at a cropped section of a construction drawing showing "' + roomName + '".\n\nImage size: ' + width + ' x ' + height + ' pixels.\n\nGive PRECISE GPS-style measurement instructions for this specific room.\n\nReturn ONLY this JSON:\n{\n  "roomName": "' + roomName + '",\n  "confirmedDimensions": "13\'-6\\" x 17\'-0\\" (from dimensions on drawing)",\n  "grossAreaSF": 229,\n  "tool": "area",\n  "toolReason": "Area tool measures square footage for flooring, tile, drywall calculations",\n  "gpsSteps": [\n    { "step": 1, "action": "Select AREA Tool", "detail": "Click the Area button in toolbar", "direction": "SELECT TOOL" },\n    { "step": 2, "action": "Click SW Corner - START", "detail": "Click bottom-left inside corner of ' + roomName + '", "direction": "START HERE" },\n    { "step": 3, "action": "Click NW Corner", "detail": "Move NORTH along west wall and click top-left corner", "direction": "GO NORTH" },\n    { "step": 4, "action": "Click NE Corner", "detail": "Move EAST along north wall and click top-right corner", "direction": "GO EAST" },\n    { "step": 5, "action": "Click SE Corner", "detail": "Move SOUTH along east wall and click bottom-right corner", "direction": "GO SOUTH" },\n    { "step": 6, "action": "Double-Click to Finish", "detail": "Double-click near starting corner to close shape", "direction": "CLOSE SHAPE" }\n  ],\n  "doors": [{ "tag": "D5", "width": "2\'-8\\"", "location": "east wall", "subtractSF": 18.7, "subtractFrom": "Drywall/tile only - NOT flooring" }],\n  "windows": [],\n  "netCalculations": {\n    "Floor Tile (full area)": "229 SF",\n    "Wall Tile gross": "229 SF",\n    "Subtract Door": "-18.7 SF",\n    "Net Wall/Drywall": "210 SF",\n    "Ceiling": "229 SF"\n  },\n  "warnings": ["Use moisture-resistant cement board backer for tile walls", "Verify exact dimensions on drawing"]\n}\n\nBe specific to what you actually see. Reference any dimensions visible. Return ONLY JSON.';

        const raw = await callClaude([{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }], 'You are BuildIQ AI Chief Estimator. Return only valid JSON as instructed.', 1500);

        let result;
        try { result = parseJSON(raw); }
        catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error: ' + e.message, raw: raw.substring(0, 300) }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
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
