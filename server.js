const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); res.end(); return;
  }

  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(data);
    });
    return;
  }

  // AI analyze endpoint
  if (req.method === 'POST' && req.url === '/api/analyze') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { imageBase64, width, height } = JSON.parse(body);

        if (!ANTHROPIC_API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'API key not configured' }));
          return;
        }

        const prompt = `You are BuildIQ, an expert AI construction estimator analyzing a construction drawing.

Image size: ${width}x${height} pixels.

Identify the single most important measurement for a contractor takeoff on this drawing. Place exact pixel coordinates for where to click.

RECOGNIZE THESE SYMBOLS:
- Walls: thick solid lines forming room boundaries
- Doors: line with arc door swing
- Windows: parallel lines breaking through a wall
- Columns: solid squares or circles at grid intersections
- Dimensions: numbers with tick marks showing distances

Respond with ONLY this JSON no other text:
{
  "sheetType": "floor_plan",
  "measurementType": "area",
  "label": "Building Footprint",
  "instruction": "Trace the outer building perimeter to get slab and footprint area.",
  "whyImportant": "Building footprint drives concrete slab roofing and MEP scope quantities.",
  "points": [
    {"x": 100, "y": 200, "label": "SW Corner"},
    {"x": 900, "y": 200, "label": "SE Corner"},
    {"x": 900, "y": 700, "label": "NE Corner"},
    {"x": 100, "y": 700, "label": "NW Corner"}
  ],
  "autoCalculations": [
    {"item": "Concrete Slab", "note": "Building footprint SF equals slab quantity"}
  ],
  "nextMeasurements": [
    "Brick veneer on all 4 elevations",
    "Interior walls linear feet",
    "Parking lot area from site plan"
  ]
}

Rules:
- x between 0 and ${width}, y between 0 and ${height}
- For area: 3 to 8 corner points
- For linear: exactly 2 points
- For count: one point per item max 20
- Return ONLY the JSON`;

        const apiResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5',
            max_tokens: 800,
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
          res.end(JSON.stringify({ error: 'Anthropic error: ' + JSON.stringify(data) }));
          return;
        }

        const rawText = data.content[0].text.trim();
        let result;
        try {
          result = JSON.parse(rawText.replace(/```json|```/g, '').trim());
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Parse error', raw: rawText.substring(0, 200) }));
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
