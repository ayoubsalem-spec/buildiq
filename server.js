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

  // AI Room Analysis endpoint
  if (req.method === 'POST' && req.url === '/api/analyze-room') {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        const { imageBase64, width, height, mode } = JSON.parse(body);

        if (!ANTHROPIC_API_KEY) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'API key not configured' }));
          return;
        }

        let prompt;

        if (mode === 'room') {
          prompt = `You are BuildIQ, an expert AI construction estimator. You are looking at a cropped section of a construction floor plan drawing.

The user clicked inside a room and this is what is currently visible on their screen (${width}x${height} pixels).

Your job is to:
1. Identify what room or area this is
2. Determine what needs to be measured (area for rooms, linear for walls/beams)
3. Give exact GPS-style step by step instructions so someone with ZERO construction experience can measure it correctly
4. Identify any doors or windows that need to be SKIPPED or SUBTRACTED
5. Draw the trace path on the image by describing it clearly

Respond with ONLY this exact JSON format, no other text:
{
  "roomName": "Green Room 1",
  "roomType": "interior room",
  "tool": "area",
  "toolInstruction": "SELECT THE AREA TOOL — click the Area button in the toolbar",
  "whyThisTool": "We use Area tool because we need square footage of this room for flooring and drywall calculations",
  "dimensions": "approximately 15'-6\" x 11'-6\" based on dimensions shown",
  "tracePath": "Trace the interior face of all 4 walls starting from the bottom-left corner going clockwise",
  "steps": [
    {
      "stepNumber": 1,
      "action": "Click SW corner",
      "detail": "Click the bottom-left corner where the south wall meets the west wall — right at the inside corner",
      "direction": "START HERE"
    },
    {
      "stepNumber": 2,
      "action": "Click NW corner",
      "detail": "Move UP along the west wall and click the top-left corner",
      "direction": "GO NORTH"
    },
    {
      "stepNumber": 3,
      "action": "Click NE corner — STOP before door",
      "detail": "Move RIGHT along the north wall — STOP just before the door opening on the right side",
      "direction": "GO EAST — STOP AT DOOR"
    },
    {
      "stepNumber": 4,
      "action": "SKIP the door opening",
      "detail": "Do NOT click inside the door opening. The door will be subtracted from the total automatically",
      "direction": "SKIP DOOR"
    },
    {
      "stepNumber": 5,
      "action": "Continue from other side of door",
      "detail": "Click at the point where the wall continues after the door opening",
      "direction": "CONTINUE EAST"
    },
    {
      "stepNumber": 6,
      "action": "Click SE corner",
      "detail": "Move DOWN along the east wall and click the bottom-right corner",
      "direction": "GO SOUTH"
    },
    {
      "stepNumber": 7,
      "action": "Double-click to close",
      "detail": "Double-click back near your starting point to close the shape and calculate the area",
      "direction": "CLOSE SHAPE"
    }
  ],
  "doorsToSubtract": [
    {
      "doorId": "D3",
      "size": "3'-0\" x 7'-0\"",
      "area": 21,
      "instruction": "Subtract door D3 — 3 ft wide x 7 ft tall = 21 SF"
    }
  ],
  "windowsToSubtract": [],
  "calculations": {
    "grossArea": "estimated from dimensions on drawing",
    "doorDeductions": "21 SF per door",
    "windowDeductions": "0 SF",
    "netDrywall": "gross area minus door and window deductions",
    "flooring": "full gross area including under door openings"
  },
  "warnings": [
    "Stage area has 100 PSF live load — flag for structural sub",
    "Measure to inside face of walls not centerline"
  ],
  "nextRoom": "Measure Green Room 2 next — directly below this room"
}

IMPORTANT RULES:
- Give step by step instructions specific to what you actually see in this image
- If you can read room labels on the drawing call them by their exact name
- If you see door symbols (arc with line) tell the user exactly where they are and to skip them
- If you see window symbols (parallel lines in wall) note them for subtraction
- If you see dimensions noted on the drawing use those exact numbers
- Tell the user which direction to move at each step (NORTH=up, SOUTH=down, EAST=right, WEST=left)
- Be specific about corners — SW=bottom-left, NW=top-left, NE=top-right, SE=bottom-right
- Return ONLY the JSON, no markdown, no explanation`;
        }

        if (mode === 'fullsheet') {
          prompt = `You are BuildIQ, an expert AI construction estimator. You are looking at a full construction drawing sheet (${width}x${height} pixels).

Scan the ENTIRE drawing and identify EVERY area that needs to be measured for a complete construction takeoff.

Respond with ONLY this exact JSON format:
{
  "sheetType": "floor_plan",
  "sheetDescription": "First floor architectural plan showing all rooms and spaces",
  "totalItems": 12,
  "measurementChecklist": [
    {
      "id": 1,
      "name": "Building Footprint",
      "type": "area",
      "tool": "area",
      "priority": "HIGH",
      "why": "Drives concrete slab, roofing, and overall project size",
      "instruction": "Trace entire outer building perimeter",
      "estimatedSF": "7652 SF per cover sheet"
    },
    {
      "id": 2,
      "name": "Main Hall",
      "type": "area",
      "tool": "area",
      "priority": "HIGH",
      "why": "Largest space — drives flooring, ceiling, and HVAC quantities",
      "instruction": "Trace interior perimeter of main hall",
      "estimatedSF": "approximately 3330 SF"
    }
  ],
  "linearMeasurements": [
    {
      "id": 1,
      "name": "Building Perimeter",
      "tool": "linear",
      "priority": "HIGH",
      "why": "Grade beam and exterior wall linear footage",
      "instruction": "Trace outer building perimeter with linear tool"
    }
  ],
  "countsNeeded": [
    {
      "name": "Doors",
      "tool": "count",
      "why": "Door count drives hardware and framing scope",
      "instruction": "Click each door symbol on the plan"
    }
  ],
  "statedQuantities": [
    {
      "item": "Total Building Area",
      "value": "7652 SF",
      "source": "Title block or cover sheet"
    }
  ],
  "warnings": [
    "Stage has 100 PSF live load — verify with structural",
    "Fire sprinkler room requires separate permit"
  ]
}

Identify EVERY room, every wall measurement, every count needed. Be thorough.
Return ONLY the JSON.`;
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
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/jpeg',
                    data: imageBase64
                  }
                },
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
