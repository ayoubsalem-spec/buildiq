const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const KEY = process.env.ANTHROPIC_API_KEY;

async function callClaude(model, maxTokens, messages) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages })
  });
  const d = await r.json();
  if (!r.ok) throw new Error('Claude API error: ' + JSON.stringify(d).substring(0, 200));
  return d.content[0].text.trim();
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

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // ── CALL 1: SCAN FULL PAGE — fast, just get room names and locations ──
  if (req.method === 'POST' && req.url === '/api/scan-rooms') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { imageBase64, width, height } = JSON.parse(body);
        if (!KEY) throw new Error('API key not set on server');

        const prompt = `Look at this construction drawing (${width}x${height} pixels).

List EVERY room, space, or area you can read a label for.

Return ONLY this JSON, nothing else:
{
  "pageType": "floor_plan",
  "rooms": [
    {
      "id": "r1",
      "name": "MAIN HALL",
      "type": "hall",
      "centerXpct": 0.55,
      "centerYpct": 0.45,
      "widthPct": 0.35,
      "heightPct": 0.40,
      "tool": "area"
    }
  ],
  "linearItems": [
    {
      "id": "l1",
      "name": "Building Perimeter",
      "tool": "linear"
    }
  ],
  "countItems": [
    {
      "id": "c1",
      "name": "Interior Doors",
      "tool": "count",
      "estimatedCount": 12
    }
  ],
  "statedQuantities": [
    { "item": "Total Building SF", "value": "7652 SF" }
  ]
}

Rules:
- centerXpct and centerYpct are 0.0 to 1.0 fractions of image width/height
- widthPct and heightPct are approximate room size as fraction of image
- type options: hall, restroom, kitchen, stage, storage, office, lobby, mechanical, green_room, foyer, other
- tool: area for rooms, linear for walls/perimeter, count for items
- List EVERY room you can see — do not skip any
- Return ONLY the JSON`;

        const raw = await callClaude('claude-haiku-4-5', 1500, [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]);

        const result = parseJSON(raw);

        // Convert percentages to actual pixel bounds
        result.rooms = (result.rooms || []).map(r => ({
          ...r,
          pixelBounds: {
            centerX: Math.round(r.centerXpct * width),
            centerY: Math.round(r.centerYpct * height),
            x: Math.round((r.centerXpct - r.widthPct / 2) * width),
            y: Math.round((r.centerYpct - r.heightPct / 2) * height),
            w: Math.round(r.widthPct * width),
            h: Math.round(r.heightPct * height)
          }
        }));

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));

      } catch (e) {
        console.error('scan-rooms error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // ── CALL 2: GPS FOR ONE ROOM — tight crop, detailed steps ──
  if (req.method === 'POST' && req.url === '/api/room-gps') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { imageBase64, width, height, roomName, roomType } = JSON.parse(body);
        if (!KEY) throw new Error('API key not set on server');

        const prompt = `You are BuildIQ, an expert construction estimator.

This image (${width}x${height} pixels) is a TIGHT CROP of the ${roomName} from a construction floor plan.
The orange crosshair marks the center of this room.

Read the drawing carefully and provide:
1. Exact room dimensions (read from dimension lines on the drawing)
2. Every door symbol (line + arc) — note which wall and door tag
3. Every window symbol (parallel lines in wall)
4. Step by step GPS instructions to trace this room

Return ONLY this JSON:
{
  "roomName": "${roomName}",
  "confirmedDimensions": "17'-0\" x 13'-6\" based on dimensions shown",
  "grossAreaSF": 229,
  "tool": "area",
  "toolReason": "We use Area tool to get square footage for flooring, drywall, and ceiling calculations",
  "gpsSteps": [
    {
      "step": 1,
      "action": "Select AREA tool",
      "detail": "Click the Area button in the toolbar above",
      "direction": "SELECT TOOL"
    },
    {
      "step": 2,
      "action": "Click SW corner — START HERE",
      "detail": "Click the bottom-left inside corner where the south wall meets the west wall",
      "direction": "START HERE"
    },
    {
      "step": 3,
      "action": "Click NW corner",
      "detail": "Move straight UP (NORTH) along the west wall and click the top-left corner",
      "direction": "GO NORTH"
    },
    {
      "step": 4,
      "action": "STOP — door opening ahead",
      "detail": "Move EAST along the north wall — STOP just before door D3",
      "direction": "STOP AT DOOR"
    },
    {
      "step": 5,
      "action": "Skip door D3",
      "detail": "Do NOT click inside the door opening. Skip over it.",
      "direction": "SKIP DOOR"
    },
    {
      "step": 6,
      "action": "Continue to NE corner",
      "detail": "Click the point where the wall continues after door D3",
      "direction": "CONTINUE EAST"
    },
    {
      "step": 7,
      "action": "Click SE corner",
      "detail": "Move SOUTH along the east wall and click the bottom-right corner",
      "direction": "GO SOUTH"
    },
    {
      "step": 8,
      "action": "Double-click to finish",
      "detail": "Double-click near your starting SW corner to close the shape",
      "direction": "DOUBLE-CLICK TO CLOSE"
    }
  ],
  "doors": [
    {
      "tag": "D3",
      "width": "3'-0\"",
      "location": "north wall",
      "subtractSF": 21,
      "subtractFrom": "drywall only — not flooring"
    }
  ],
  "windows": [],
  "netCalculations": {
    "flooringSF": "229 SF (full gross area)",
    "drywallSF": "229 SF minus 21 SF (door D3) = 208 SF net",
    "ceilingSF": "229 SF"
  },
  "category": "${roomType || 'interior_room'}",
  "warnings": []
}

Use only what you actually see in this image. Read real dimension numbers if visible. Return ONLY JSON.`;

        const raw = await callClaude('claude-sonnet-4-6', 2000, [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: prompt }
          ]
        }]);

        const result = parseJSON(raw);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));

      } catch (e) {
        console.error('room-gps error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`BuildIQ running on port ${PORT}`));
