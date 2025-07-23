import express from "express";
import serverless from "serverless-http";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const API_KEYS = process.env.NODE_ENV === "production" ? [
  process.env.API_KEY_1,
  process.env.API_KEY_2,
  process.env.API_KEY_3
] : [
  "bd387d9ec32783f00020a0b3dc2da01ee150580bb62cde657f600d9a9ac1deaa",
  "3f24e38734da5e1be049345f611dc956ce6351bcfda6b36210e342fa356ffbd0",
  "ccca937c293806f2d535b38b4d2a347cfac9ef5d7f8649695a95ff4c9d89f1df"
];
let currentKeyIndex = 0;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get("/api/health", (req, res) => {
  res.json({ status: "OK", message: "API server is running" });
});

// Rate limiter: 1 request every 6 seconds (10 requests/min)
let lastRequested = 0;
const MIN_INTERVAL = 6000;

function roundToMultipleOf16(x) {
  return Math.max(16, Math.round(x / 16) * 16);
}

async function tryWithNextKey(reqBody, res, attempt = 0) {
  if (attempt >= API_KEYS.length) {
    console.error("All API keys exhausted");
    return res.status(429).json({ error: "All API keys have reached their rate limit." });
  }

  const now = Date.now();
  if (now - lastRequested < MIN_INTERVAL) {
    console.warn(`Rate limit hit, wait ${Math.ceil((MIN_INTERVAL - (now - lastRequested)) / 1000)}s`);
    return res.status(429).json({
      error: `Rate limit: please wait ${Math.ceil((MIN_INTERVAL - (now - lastRequested)) / 1000)}s`
    });
  }
  lastRequested = now;

  const { prompt, width, height, steps, n } = reqBody;
  if (!prompt) {
    console.error("Empty prompt received");
    return res.status(400).json({ error: "Prompt kosong!" });
  }

  const w = roundToMultipleOf16(parseInt(width, 10) || 1024);
  const h = roundToMultipleOf16(parseInt(height, 10) || 1024);
  const s = Math.min(Math.max(parseInt(steps, 10) || 3, 1), 4);
  const count = Math.min(Math.max(parseInt(n, 10) || 1, 1), 4);

  try {
    console.log(`Attempting with API key ${currentKeyIndex + 1}/${API_KEYS.length}`);
    const apiRes = await fetch("https://api.together.ai/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEYS[currentKeyIndex]}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "black-forest-labs/FLUX.1-schnell-Free",
        prompt,
        n: count,
        width: w,
        height: h,
        steps: s,
        response_format: "url"
      })
    });
    const data = await apiRes.json();

    if (apiRes.status === 429 || data.error?.type === "model_rate_limit") {
      console.warn(`Rate limit for key ${currentKeyIndex + 1}, switching to next key`);
      currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
      return tryWithNextKey(reqBody, res, attempt + 1);
    }
    if (!data.data?.[0]?.url) {
      console.error("No image URL returned:", JSON.stringify(data));
      return res.status(500).json({ error: "No image returned", full: data });
    }
    console.log("Image generated successfully");
    res.json(data);
  } catch (err) {
    console.error("API request failed:", err.message);
    res.status(500).json({ error: "Failed contacting Together API.", details: err.message });
  }
}

app.post("/api/generate-image", async (req, res) => {
  console.log("Received request to /api/generate-image");
  await tryWithNextKey(req.body, res);
});

export default serverless(app);

// For local development
if (process.env.NODE_ENV !== "production") {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`✅ Server running at http://localhost:${PORT}`));
}