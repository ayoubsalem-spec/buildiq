const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const MAX_BODY = Number(process.env.MAX_BODY_BYTES || 80 * 1024 * 1024);
const MAX_PROJECT_PAGES = Number(process.env.MAX_PROJECT_PAGES || 50);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(body);
}

function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, maxBytes = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let finished = false;

    const fail = (err) => {
      if (finished) return;
      finished = true;
      reject(err);
      req.destroy();
    };

    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        fail(new Error(`Request is too large. Maximum is ${Math.round(maxBytes / 1024 / 1024)} MB.`));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!finished) {
        finished = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
    req.on('error', fail);
  });
}

async function readJson(req, maxBytes = MAX_BODY) {
  const raw = await readBody(req, maxBytes);
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw new Error('Invalid JSON request body.');
  }
}

function stripCodeFences(text) {
  return String(text || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function extractJson(text) {
  const clean = stripCodeFences(text);
  try { return JSON.parse(clean); } catch {}

  const firstObj = clean.indexOf('{');
  const lastObj = clean.lastIndexOf('}');
  if (firstObj >= 0 && lastObj > firstObj) {
    try { return JSON.parse(clean.slice(firstObj, lastObj + 1)); } catch {}
  }

  const firstArr = clean.indexOf('[');
  const lastArr = clean.lastIndexOf(']');
  if (firstArr >= 0 && lastArr > firstArr) {
    try { return JSON.parse(clean.slice(firstArr, lastArr + 1)); } catch {}
  }

  throw new Error('AI returned non-JSON output.');
}

function validateImageBase64(value) {
  if (typeof value !== 'string' || value.length < 100) {
    throw new Error('A valid base64 image is required.');
  }
  // Reject obviously dangerous data URLs while accepting raw base64.
  return value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '');
}

async function callAnthropic({ imageBase64, prompt, width, height, maxTokens = 3000 }) {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured.');

  const image = validateImageBase64(imageBase64);
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/jpeg', data: image }
          },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });

  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  if (!response.ok) {
    const detail = data?.error?.message || data?.error || text.slice(0, 500);
    throw new Error(`Anthropic API error (${response.status}): ${detail}`);
  }

  const output = data?.content?.find(x => x.type === 'text')?.text;
  if (!output) throw new Error('Anthropic returned no text content.');

  return extractJson(output);
}

function normalizeSheetType(value) {
  const allowed = ['cover', 'architectural', 'structural', 'civil', 'mechanical', 'electrical', 'plumbing', 'fire_protection', 'site_plan', 'floor_plan', 'roof_plan', 'elevation', 'details', 'specifications', 'other'];
  const v = String(value || '').toLowerCase().replace(/\s+/g, '_');
  return allowed.includes(v) ? v : 'other';
}

function normalizeMeasurementType(value) {
  const v = String(value || '').toLowerCase();
  return ['area', 'linear', 'count'].includes(v) ? v : 'area';
}

function clamp01(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0;
}

function sanitizeTakeoffItem(item) {
  const sourceBox = Array.isArray(item?.sourceBox) && item.sourceBox.length === 4
    ? item.sourceBox.map(clamp01)
    : null;
  return {
    name: String(item?.name || 'Unnamed takeoff item').slice(0, 180),
    measurementType: normalizeMeasurementType(item?.measurementType),
    priority: ['HIGH', 'MEDIUM', 'LOW'].includes(String(item?.priority || '').toUpperCase())
      ? String(item.priority).toUpperCase() : 'MEDIUM',
    why: String(item?.why || '').slice(0, 500),
    source: String(item?.source || '').slice(0, 180),
    confidence: clamp01(item?.confidence),
    sourceBox,
    estimatedQuantity: item?.estimatedQuantity == null ? '' : String(item.estimatedQuantity).slice(0, 80),
    notes: Array.isArray(item?.notes) ? item.notes.map(x => String(x).slice(0, 300)).slice(0, 10) : [],
    reviewed: Boolean(item?.reviewed)
  };
}

function sanitizeSheet(sheet, page) {
  const takeoffItems = Array.isArray(sheet?.takeoffItems)
    ? sheet.takeoffItems.slice(0, 30).map(sanitizeTakeoffItem) : [];
  return {
    page,
    sheetNumber: String(sheet?.sheetNumber || '').slice(0, 80),
    title: String(sheet?.title || 'Untitled sheet').slice(0, 200),
    sheetType: normalizeSheetType(sheet?.sheetType),
    description: String(sheet?.description || '').slice(0, 500),
    confidence: clamp01(sheet?.confidence),
    takeoffItems,
    warnings: Array.isArray(sheet?.warnings) ? sheet.warnings.map(x => String(x).slice(0, 300)).slice(0, 12) : [],
    reviewStatus: 'unreviewed'
  };
}

const classificationPrompt = (page, width, height) => `You are BuildIQ, an expert construction estimator and drawing-set document classifier.

Analyze this single construction drawing sheet image. Your task is CLASSIFICATION and SCOPE DISCOVERY only. Do not invent exact quantities. If a quantity is explicitly printed on the sheet, you may report it as a stated quantity, but distinguish it from an AI estimate.

Image size: ${width} x ${height} pixels.
Page number in uploaded PDF: ${page}.

Return ONLY JSON:
{
  "sheetNumber": "exact visible sheet number if readable, otherwise empty",
  "title": "exact visible sheet title if readable, otherwise concise inferred title",
  "sheetType": "cover|architectural|structural|civil|mechanical|electrical|plumbing|fire_protection|site_plan|floor_plan|roof_plan|elevation|details|specifications|other",
  "description": "what this sheet contains",
  "confidence": 0.0,
  "takeoffPotential": "HIGH|MEDIUM|LOW",
  "takeoffItems": [
    {
      "name": "specific scope item",
      "measurementType": "area|linear|count",
      "priority": "HIGH|MEDIUM|LOW",
      "why": "why an estimator needs this quantity",
      "source": "where on this sheet the estimator should look",
      "confidence": 0.0,
      "sourceBox": [0.0,0.0,1.0,1.0],
      "estimatedQuantity": "",
      "notes": ["measurement caveat or cross-reference"]
    }
  ],
  "warnings": ["only warnings actually supported by what is visible"]
}

Rules:
- Do not fabricate dimensions, quantities, code requirements, or scope.
- Use normalized sourceBox coordinates 0..1.
- sourceBox should cover the visual region relevant to the item.
- For a sheet with no useful takeoff scope, return an empty takeoffItems array.
- Prefer practical estimator scope: concrete, foundations, grade beams, masonry, drywall, flooring, roofing, paving, doors, windows, equipment, fixtures, ductwork, piping, electrical devices, fire protection, etc.
- Identify cross-references when visible.
- Return valid JSON only.`;

const sheetTakeoffPrompt = (page, sheetNumber, width, height, context) => `You are BuildIQ, a senior construction estimator reviewing one drawing sheet for an estimator-assisted AI takeoff.

This is page ${page}, sheet ${sheetNumber || 'unknown'}, image size ${width}x${height}.
Known sheet context:
${JSON.stringify(context || {}, null, 2)}

Your task is to produce a REVIEWABLE takeoff plan. The system will not blindly accept AI quantities. It will use your output to guide a human estimator and, where possible, calculate geometry from verified points.

Return ONLY JSON:
{
  "sheetNumber": "${String(sheetNumber || '').replace(/"/g, '')}",
  "takeoffItems": [
    {
      "name": "specific item",
      "measurementType": "area|linear|count",
      "priority": "HIGH|MEDIUM|LOW",
      "why": "cost or scope impact",
      "source": "visible source region/detail/grid",
      "confidence": 0.0,
      "sourceBox": [0.0,0.0,1.0,1.0],
      "estimatedQuantity": "",
      "notes": ["only evidence-based notes"],
      "points": [
        {"x":0,"y":0,"label":"point description"}
      ],
      "calculation": {
        "formula": "",
        "unit": "SF|LF|EA"
      }
    }
  ],
  "statedQuantities": [
    {"item":"", "value":"", "source":""}
  ],
  "warnings": [],
  "crossReferences": [
    {"item":"", "sheet":"", "reason":""}
  ]
}

Critical accuracy rules:
- Do NOT claim exact measurements from pixels unless the geometry is unmistakably visible.
- Do NOT invent scale. If scale is not visible, leave estimatedQuantity blank and note that calibration is required.
- For area items, points must be a reasonable polygon only when the perimeter is clearly visible; otherwise return an empty points array and explain why.
- For linear items, return exactly two points only when the endpoints are clearly visible.
- For counts, points may mark visible instances, but never exceed 50.
- Coordinates must be within 0..${width} and 0..${height}.
- Prefer evidence over completeness. It is better to flag "requires estimator review" than fabricate a quantity.
- Return JSON only.`;

async function classifyDrawingSet(pages, projectName) {
  const sheets = [];
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const prompt = classificationPrompt(p.page, p.width, p.height);
    const result = await callAnthropic({
      imageBase64: p.imageBase64,
      prompt,
      width: p.width,
      height: p.height,
      maxTokens: 1800
    });
    sheets.push(sanitizeSheet(result, Number(p.page) || i + 1));
  }

  const summary = {
    takeoffSheets: sheets.filter(s => s.takeoffItems.length > 0).length,
    highPriority: sheets.reduce((n, s) => n + s.takeoffItems.filter(i => i.priority === 'HIGH').length, 0),
    byType: sheets.reduce((acc, s) => {
      acc[s.sheetType] = (acc[s.sheetType] || 0) + 1;
      return acc;
    }, {})
  };

  return {
    projectName: String(projectName || 'Untitled Project').slice(0, 200),
    generatedAt: new Date().toISOString(),
    status: 'classified',
    summary,
    sheets
  };
}

async function handleAnalyzeRoom(req, res) {
  const body = await readJson(req);
  const { imageBase64, width, height, mode } = body;
  if (!imageBase64) return sendJson(res, 400, { error: 'No image provided.' });

  const roomPrompt = `You are BuildIQ, an expert construction estimator analyzing a cropped construction floor plan.

The user wants practical, evidence-based measurement guidance. Image size: ${width}x${height}.
Return ONLY JSON:
{
  "roomName": "exact visible room name or descriptive fallback",
  "roomType": "room type",
  "tool": "area|linear|count",
  "toolInstruction": "what tool to activate",
  "whyThisTool": "why this measurement matters",
  "dimensions": "only dimensions actually readable",
  "tracePath": "specific trace guidance based on visible geometry",
  "steps": [{"stepNumber":1,"action":"","detail":"","direction":""}],
  "doorsToSubtract": [{"doorId":"","size":"","area":0,"instruction":""}],
  "windowsToSubtract": [{"windowId":"","size":"","area":0,"instruction":""}],
  "calculations": {"grossArea":"","doorDeductions":"","windowDeductions":"","netDrywall":"","flooring":""},
  "warnings": [],
  "nextRoom": ""
}
Rules: Never invent dimensions or quantities. If uncertain, say "not readable" or leave empty. Return JSON only.`;

  const result = await callAnthropic({
    imageBase64, prompt: roomPrompt, width, height, maxTokens: 2500
  });
  return sendJson(res, 200, result);
}

async function handleAnalyzeSheet(req, res) {
  const body = await readJson(req);
  const { imageBase64, width, height, page, sheetNumber, sheetContext } = body;
  if (!imageBase64) return sendJson(res, 400, { error: 'No image provided.' });

  const result = await callAnthropic({
    imageBase64,
    prompt: sheetTakeoffPrompt(page, sheetNumber, width, height, sheetContext),
    width,
    height,
    maxTokens: 4000
  });

  const takeoffItems = Array.isArray(result.takeoffItems)
    ? result.takeoffItems.slice(0, 40).map(item => ({
        ...sanitizeTakeoffItem(item),
        points: Array.isArray(item.points) ? item.points.slice(0, 50).map(p => ({
          x: Math.max(0, Math.min(Number(width) || 1, Number(p?.x) || 0)),
          y: Math.max(0, Math.min(Number(height) || 1, Number(p?.y) || 0)),
          label: String(p?.label || '').slice(0, 100)
        })) : [],
        calculation: {
          formula: String(item?.calculation?.formula || '').slice(0, 300),
          unit: ['SF','LF','EA'].includes(item?.calculation?.unit) ? item.calculation.unit : ''
        }
      }))
    : [];

  return sendJson(res, 200, {
    sheetNumber: String(sheetNumber || ''),
    takeoffItems,
    statedQuantities: Array.isArray(result.statedQuantities) ? result.statedQuantities.slice(0, 50) : [],
    warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 20) : [],
    crossReferences: Array.isArray(result.crossReferences) ? result.crossReferences.slice(0, 30) : []
  });
}

async function handleAnalyzeLegacy(req, res) {
  const body = await readJson(req);
  const { imageBase64, width, height, context } = body;
  if (!imageBase64) return sendJson(res, 400, { error: 'No image provided.' });

  const prompt = `You are BuildIQ, an expert construction estimator. Analyze this drawing for the single most useful next measurement.

Context:
${JSON.stringify(context || {}, null, 2)}

Return ONLY JSON:
{
  "sheetType":"floor_plan|site_plan|elevation|roof_plan|structural|mechanical|electrical|plumbing",
  "measurementType":"area|linear|count",
  "label":"specific descriptive name",
  "instruction":"one sentence",
  "whyImportant":"one sentence",
  "points":[{"x":0,"y":0,"label":""}],
  "autoCalculations":[],
  "nextMeasurements":[]
}
Rules:
- Coordinates must be inside ${width}x${height}.
- Never fabricate precision. If geometry is unclear, return the best clearly visible perimeter only.
- Return JSON only.`;

  const result = await callAnthropic({ imageBase64, prompt, width, height, maxTokens: 2000 });
  return sendJson(res, 200, result);
}

async function handleRequest(req, res) {
  // CORS is intentionally limited to same-origin use by default.
  // Set ALLOW_ORIGIN for a separate frontend domain.
  const origin = process.env.ALLOW_ORIGIN;
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');

  if (req.method === 'OPTIONS') {
    res.writeHead(204); return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const filePath = path.join(__dirname, 'index.html');
    try {
      const data = await fs.promises.readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
      return res.end(data);
    } catch {
      return sendText(res, 404, 'BuildIQ index.html not found.');
    }
  }

  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'BuildIQ',
      model: ANTHROPIC_MODEL,
      apiConfigured: Boolean(ANTHROPIC_API_KEY),
      timestamp: new Date().toISOString()
    });
  }

  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });

  try {
    if (pathname === '/api/analyze-room') return await handleAnalyzeRoom(req, res);
    if (pathname === '/api/analyze-sheet') return await handleAnalyzeSheet(req, res);
    if (pathname === '/api/analyze') return await handleAnalyzeLegacy(req, res);

    if (pathname === '/api/analyze-drawing-set') {
      const body = await readJson(req, MAX_BODY);
      const pages = Array.isArray(body.pages) ? body.pages : [];
      if (!pages.length) return sendJson(res, 400, { error: 'No drawing pages supplied.' });
      if (pages.length > MAX_PROJECT_PAGES) {
        return sendJson(res, 400, { error: `Drawing set exceeds ${MAX_PROJECT_PAGES} pages per AI scan.` });
      }

      // Avoid a huge unbounded request and reject malformed pages early.
      for (const p of pages) {
        if (!Number.isFinite(Number(p.page)) || !p.imageBase64 || !Number.isFinite(Number(p.width)) || !Number.isFinite(Number(p.height))) {
          return sendJson(res, 400, { error: 'Each page must include page, imageBase64, width, and height.' });
        }
      }

      const result = await classifyDrawingSet(pages, body.projectName);
      return sendJson(res, 200, result);
    }

    return sendJson(res, 404, { error: 'API route not found.' });
  } catch (err) {
    console.error('[BuildIQ]', err);
    return sendJson(res, 500, { error: err?.message || 'Unexpected server error.' });
  }
}

const server = http.createServer(handleRequest);
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 10 * 60 * 1000;

server.listen(PORT, HOST, () => {
  console.log(`BuildIQ running on http://${HOST}:${PORT}`);
  console.log(`Anthropic model: ${ANTHROPIC_MODEL}`);
  console.log(`AI key configured: ${Boolean(ANTHROPIC_API_KEY)}`);
});
