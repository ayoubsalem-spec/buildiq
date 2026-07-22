export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Only allow POST
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
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const contextStr = context ? `
Project context already extracted from drawings:
${JSON.stringify(context, null, 2)}
Use this information to make smarter measurement recommendations.
` : '';

    const prompt = `You are BuildIQ, an expert AI construction estimator with 30 years of experience reading construction drawings.

You are looking at a construction drawing that is ${width}x${height} pixels.

${contextStr}

Your job: Analyze this drawing and identify the SINGLE most important measurement a contractor needs for their takeoff. Place exact pixel coordinates showing where to click.

CONSTRUCTION DRAWING SYMBOLS TO RECOGNIZE:
- Walls: thick solid lines forming room boundaries
- Doors: shown as a line with an arc (door swing) — subtract from wall area
- Windows: shown as parallel lines breaking through a wall — subtract from wall area  
- Columns: solid squares or circles at grid intersections
- Stairs: parallel lines with arrow showing direction
- Dimensions: numbers with lines showing distances
- Grid lines: thin dashed lines with circles at ends labeled A,B,C or 1,2,3

FOR FLOOR PLANS — identify:
- Building perimeter walls (for slab and footprint area)
- Interior partition walls (for drywall)
- Door openings (count and locate)
- Window openings (count and locate)
- Room boundaries (for flooring)

FOR SITE PLANS — identify:
- Building footprint
- Parking areas
- Walkways and drives

FOR ELEVATIONS — identify:
- Wall faces (for brick/cladding)
- Window openings to subtract
- Door openings to subtract

FOR ROOF PLANS — identify:
- Roof boundary
- Different roof planes

Respond with ONLY this exact JSON format, no other text:
{
  "sheetType": "floor_plan" or "site_plan" or "elevation" or "roof_plan" or "structural" or "mechanical" or "electrical" or "plumbing",
  "measurementType": "area" or "linear" or "count",
  "label": "specific descriptive name e.g. Building Footprint - First Floor",
  "instruction": "One sentence explaining what this measures and why it matters for the bid",
  "whyImportant": "One sentence on the cost impact of this measurement",
  "points": [
    {"x": 100, "y": 200, "label": "NW Corner - Grid A1"},
    {"x": 500, "y": 200, "label": "NE Corner - Grid A7"},
    {"x": 500, "y": 600, "label": "SE Corner - Grid D7"},
    {"x": 100, "y": 600, "label": "SW Corner - Grid D1"}
  ],
  "autoCalculations": [
    {
      "item": "Net Drywall Area",
      "formula": "Gross Wall Area - Door Openings - Window Openings",
      "note": "Subtract 31 doors × 21 SF + 18 windows × 16 SF from gross wall area"
    }
  ],
  "nextMeasurements": [
    "Brick veneer — measure all 4 elevations",
    "Parking lot — measure from site plan",
    "Interior walls — measure from floor plan"
  ]
}

Rules:
- Coordinates must be within image bounds: x 0-${width}, y 0-${height}
- For area: 3-8 corner points tracing the perimeter precisely
- For linear: exactly 2 points
- For count: one point per item, max 30
- Be as precise as possible with coordinates — zoom into the drawing mentally
- autoCalculations and nextMeasurements are optional but add them when you can
- ONLY return the JSON, nothing else`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
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
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    const rawText = data.content[0].text.trim();

    // Parse JSON safely
    let result;
    try {
      const clean = rawText.replace(/```json|```/g, '').trim();
      result = JSON.parse(clean);
    } catch (e) {
      return new Response(JSON.stringify({ error: 'Failed to parse AI response', raw: rawText }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
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
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
