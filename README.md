# BuildIQ AI Chief Estimator — V2

BuildIQ is an AI-assisted construction drawing review and takeoff workspace.

## What changed

- Preserved the existing PDF viewer, zoom/pan, calibration, manual area/linear/count tools, room guidance, full-sheet scan, CSV export, and AI workflow.
- Added **AI Project Takeoff**:
  1. Render every PDF sheet.
  2. AI classifies each sheet.
  3. AI identifies likely takeoff scope with confidence and source regions.
  4. Estimator selects a sheet and runs deeper takeoff analysis.
  5. AI returns reviewable takeoff items, source boxes, cross-references, warnings, and optional visible points.
  6. Estimator can jump to source, review/measure, or mark an item reviewed.
  7. Export an AI takeoff plan to CSV.
- Added robust JSON parsing, request-size protection, API error handling, health endpoint, and Railway configuration.
- API keys remain server-side.
- AI output is deliberately treated as **reviewable recommendations**, not blindly trusted quantities.

## Railway

1. Create a Railway service from this repository/project.
2. Set the environment variable `ANTHROPIC_API_KEY`.
3. Deploy.
4. Open `/health` and confirm `ok: true` and `apiConfigured: true`.
5. Open the root URL and upload a PDF drawing set.

The application listens on Railway's `PORT` and binds to `0.0.0.0`.

## Local

Requirements: Node.js 20+.

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Important production note

Construction takeoffs are high-consequence estimates. BuildIQ should not be represented as replacing professional estimator review. The V2 architecture intentionally keeps a human approval step and source evidence for AI recommendations.

## Cost control

The AI Project Takeoff scan sends one image per sheet to the vision model. Large drawing sets can therefore create significant API usage. For production, add authentication, per-user quotas, job queues, caching, and persistent project storage before opening the app to multiple users.
