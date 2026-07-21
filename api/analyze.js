export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { imageBase64, width, height, context } = body;

    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'No image provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured on server' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const prompt = `You are BuildIQ, an expert AI construction estimator analyzing a construction drawing.

Image size: ${width}x${height} pixels.

Identify the single most important measurement for a contractor takeoff on this specific drawing sheet. Place exact pixel coordinates for where to click.

RECOGNIZE THESE SYMBOLS:
- Walls: thick solid lines forming room boundaries
- Doors: line with arc (door swing)
- Windows: parallel lines breaking through a wall
- Columns: solid squares or circles at grid intersections
- Dimensions: numbers with tick marks showing distances
- Grid lines: thin lines with circles labeled A,B,C or 1,2,3

Respond with ONLY this JSON, no other text:
{
  "sheetType": "floor_plan",
  "measurementType": "area",
  "label": "Building Footprint - First Floor",
  "instruction": "Trace the outer building perimeter to get the slab and footprint area.",
  "whyImportant": "Building footprint drives concrete slab, roofing, and MEP scope quantities.",
  "points": [
    {"x": 100, "y": 200, "label": "SW Corner"},
    {"x": 900, "y": 200, "label": "SE Corner"},
    {"x": 900, "y": 700, "label": "NE Corner"},
    {"x": 100, "y": 700, "label": "NW Corner"}
  ],
  "autoCalculations": [
    {
      "item": "Concrete Slab",
      "note": "Building footprint SF = slab quantity for concrete sub"
    }
  ],
  "nextMeasurements": [
    "Brick veneer - measure all 4 elevations",
    "Interior walls - linear feet from floor plan",
    "Parking lot - area from site plan"
  ]
}

Rules:
- x must be between 0 and ${width}
- y must be between 0 and ${height}  
- For area: 3-8 corner points tracing the perimeter
- For linear: exactly 2 points
- For count: one point per item max 20
- Return ONLY the JSON object`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 800,
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

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: 'Anthropic API error: ' + err }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const data = await response.json();
    const rawText = data.content[0].text.trim();

    let result;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      result = JSON.parse(clean);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'AI parse error', raw: rawText.substring(0, 200) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}
