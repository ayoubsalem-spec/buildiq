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

        const prompt = `You are BuildIQ, an expert AI construction estimator with 30 years experience reading construction drawings.

You are analyzing page ${pageNum} of ${totalPages} of a construction drawing set.
Image dimensions: ${width} x ${height} pixels.

READ THIS DRAWING COMPLETELY and identify EVERY room, space, and area visible.

For EACH room or space you find:
1. Read the EXACT room label text as printed on the drawing
2. Read ALL dimension numbers shown (like 17'-0", 20'-0", 66'-10")
3. Identify the approximate pixel boundaries of that room on this image
4. Find every door symbol (line + arc = door swing) in or bordering that room
5. Find every window symbol (parallel lines in wall) in that room
6. Determine what tool to use: area for rooms/floors, linear for walls/beams, count for items

DOOR SYMBOLS: A straight line showing door width + a quarter-circle arc showing swing direction
WINDOW SYMBOLS: Two parallel lines that break through a wall line
GRID LINES: Thin lines with circles containing numbers (1,2,3) or letters (A,B,C) at the edges
DIMENSIONS: Numbers between tick marks or arrows showing distances

Return ONLY this exact JSON — no other text:
{
  "pageType": "floor_plan",
  "pageDescription": "First floor architectural plan",
  "scale": "1/8 inch = 1 foot",
  "rooms": [
    {
      "id": "room_1",
      "name": "WOMEN RESTROOM",
      "label": "WOMEN RESTROOM",
      "type": "restroom",
      "width": "approximately 13'-6\"",
      "height": "17'-0\"",
      "pixelBounds": {
        "x": 850,
        "y": 420,
        "w": 180,
        "h": 240,
        "centerX": 940,
        "centerY": 540
      },
      "tool": "area",
      "measurementPurpose": "Flooring, wall tile, ceiling, and plumbing fixture layout",
      "gpsSteps": [
        {
          "step": 1,
          "action": "Click SW corner — START HERE",
          "detail": "Click the bottom-left inside corner where the south wall meets the west wall of the Women Restroom",
          "direction": "START HERE"
        },
        {
          "step": 2,
          "action": "Click NW corner",
          "detail": "Move NORTH along the west wall approximately 17'-0\" and click the top-left corner",
          "direction": "GO NORTH — 17'-0\""
        },
        {
          "step": 3,
          "action": "Click NE corner",
          "detail": "Move EAST along the north wall and click the top-right corner",
          "direction": "GO EAST"
        },
        {
          "step": 4,
          "action": "Click SE corner",
          "detail": "Move SOUTH along the east wall approximately 17'-0\" and click the bottom-right corner",
          "direction": "GO SOUTH — 17'-0\""
        },
        {
          "step": 5,
          "action": "Double-click to close",
          "detail": "Double-click near your starting point to close the shape and calculate the area",
          "direction": "CLOSE SHAPE"
        }
      ],
      "doors": [
        {
          "id": "D5",
          "width": "2'-8\"",
          "location": "south wall",
          "subtractSF": 18.7
        }
      ],
      "windows": [],
      "calculations": {
        "grossArea": "approximately 229 SF based on 13'-6\" x 17'-0\"",
        "doorDeductions": "18.7 SF (door D5)",
        "netFloorArea": "229 SF (no deduction for flooring — measure full floor)",
        "netWallArea": "229 SF minus 18.7 SF door = 210 SF net drywall/tile"
      },
      "warnings": ["Verify exact dimensions on drawing", "Moisture resistant drywall required in restrooms"]
    }
  ],
  "linearItems": [
    {
      "id": "linear_1",
      "name": "Building Perimeter",
      "description": "Outer building boundary for grade beam and exterior wall",
      "tool": "linear",
      "gpsSteps": [
        {
          "step": 1,
          "action": "Click any exterior corner",
          "detail": "Start at any outside corner of the building",
          "direction": "START"
        },
        {
          "step": 2,
          "action": "Trace the full perimeter",
          "detail": "Click each corner going clockwise around the outside of the building",
          "direction": "GO CLOCKWISE"
        }
      ]
    }
  ],
  "countItems": [
    {
      "id": "count_1",
      "name": "Interior Doors",
      "description": "Count all interior door symbols on this sheet",
      "tool": "count",
      "estimatedCount": 31,
      "gpsSteps": [
        {
          "step": 1,
          "action": "Select COUNT tool",
          "detail": "Click the Count button in the toolbar",
          "direction": "SELECT COUNT"
        },
        {
          "step": 2,
          "action": "Click each door",
          "detail": "Click once on each door symbol you see — look for the arc shapes throughout the plan",
          "direction": "CLICK EACH DOOR"
        }
      ]
    }
  ],
  "statedQuantities": [
    {
      "item": "Total Building Area",
      "value": "7,652 SF",
      "foundOn": "Title block or cover sheet notes"
    }
  ],
  "warnings": [
    "Stage has 100 PSF live load — flag for structural sub",
    "Fire sprinkler system is separate permit"
  ]
}

CRITICAL RULES:
- pixelBounds must be accurate — this is how users click on rooms
- centerX and centerY must be inside the room so click detection works
- Read EVERY room label exactly as printed
- Include EVERY room visible — do not skip any
- GPS steps must reference actual dimensions shown on the drawing
- Return ONLY the JSON object, nothing else`;

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
        let result;
        try {
          result = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch(e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error', raw: raw.substring(0, 300) }));
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
