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

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ENDPOINT: Analyze full drawing page — builds complete room map
  if (req.method === 'POST' && req.url === '/api/analyze-drawing') {
    let body = '';
    req.on('data', c => body += c.toString());
    req.on('end', async () => {
      try {
        const { imageBase64, width, height, pageNum, totalPages } = JSON.parse(body);

        const prompt = `You are BuildIQ, an expert AI construction estimator. Analyze this construction drawing and identify every room and measurement area.

Image: ${width}x${height} pixels.

You MUST return ONLY a valid JSON object. No text before or after. No markdown. No explanation. Just the JSON.

Find every room label on the drawing. For each room provide:
- Exact name as printed
- Approximate pixel location (center point and bounding box)
- Dimensions if shown on drawing
- GPS steps to trace it
- Any doors or windows to subtract

JSON format:
{
  "pageType": "floor_plan",
  "pageDescription": "brief description",
  "rooms": [
    {
      "id": "room_1",
      "name": "WOMEN RESTROOM",
      "label": "WOMEN RESTROOM",
      "type": "restroom",
      "width": "13'-6\"",
      "height": "17'-0\"",
      "pixelBounds": {"x": 850, "y": 420, "w": 180, "h": 240, "centerX": 940, "centerY": 540},
      "tool": "area",
      "measurementPurpose": "Flooring tile, wall tile, ceiling, plumbing layout",
      "gpsSteps": [
        {"step": 1, "action": "Click SW corner - START HERE", "detail": "Click bottom-left inside corner where south wall meets west wall", "direction": "START HERE"},
        {"step": 2, "action": "Click NW corner", "detail": "Move NORTH along west wall 17-0 and click top-left corner", "direction": "GO NORTH"},
        {"step": 3, "action": "Click NE corner", "detail": "Move EAST along north wall and click top-right corner", "direction": "GO EAST"},
        {"step": 4, "action": "Click SE corner", "detail": "Move SOUTH along east wall and click bottom-right corner", "direction": "GO SOUTH"},
        {"step": 5, "action": "Double-click to close", "detail": "Double-click near starting point to close shape", "direction": "CLOSE SHAPE"}
      ],
      "doors": [{"id": "D5", "width": "2-8", "location": "south wall", "subtractSF": 18.7}],
      "windows": [],
      "calculations": {"grossArea": "229 SF", "doorDeductions": "18.7 SF", "netWallArea": "210 SF"},
      "warnings": ["Moisture resistant drywall required"]
    }
  ],
  "linearItems": [
    {
      "id": "linear_1",
      "name": "Building Perimeter",
      "description": "Outer building boundary for grade beam",
      "tool": "linear",
      "gpsSteps": [
        {"step": 1, "action": "Click any exterior corner", "detail": "Start at any outside building corner", "direction": "START"},
        {"step": 2, "action": "Trace full perimeter clockwise", "detail": "Click each corner going clockwise around building", "direction": "CLOCKWISE"}
      ]
    }
  ],
  "countItems": [
    {
      "id": "count_1",
      "name": "Interior Doors",
      "description": "Count all door symbols on this sheet",
      "tool": "count",
      "estimatedCount": 12,
      "gpsSteps": [
        {"step": 1, "action": "Select COUNT tool", "detail": "Click Count button in toolbar", "direction": "SELECT COUNT"},
        {"step": 2, "action": "Click each door symbol", "detail": "Click once on each door arc you see on the plan", "direction": "CLICK EACH DOOR"}
      ]
    }
  ],
  "statedQuantities": [
    {"item": "Total Building Area", "value": "7652 SF", "foundOn": "Title block"}
  ],
  "warnings": ["Flag any special conditions here"]
}

RULES:
- pixelBounds must reflect actual room locations on this ${width}x${height} pixel image
- Read every visible room label - do not skip any rooms
- Include GPS steps for every room
- Return ONLY the JSON object - nothing else before or after`;

        const apiResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 4000,
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

        const raw = data.content[0].text.trim();
        console.log('AI raw response length:', raw.length);
        console.log('AI raw first 200 chars:', raw.substring(0, 200));
        
        let result;
        try {
          // Try multiple cleaning strategies
          let cleaned = raw;
          
          // Remove markdown code blocks
          cleaned = cleaned.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
          
          // If starts with text before {, find the first {
          const firstBrace = cleaned.indexOf('{');
          const lastBrace = cleaned.lastIndexOf('}');
          if (firstBrace > 0) {
            cleaned = cleaned.substring(firstBrace, lastBrace + 1);
          }
          
          result = JSON.parse(cleaned);
        } catch(e) {
          console.error('Parse failed:', e.message);
          console.error('Raw response:', raw.substring(0, 500));
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: 'AI response could not be parsed. Raw: ' + raw.substring(0, 200)
          }));
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

server.listen(PORT, () => console.log('BuildIQ running on port ' + PORT));
