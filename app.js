import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import serverless from "serverless-http";
import path from "path";
import { fileURLToPath } from "url";

// Setup __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize express
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Configuration
const API_KEYS = process.env.API_KEYS ? process.env.API_KEYS.split(",") : [
  "bd387d9ec32783f00020a0b3dc2da01ee150580bb62cde657f600d9a9ac1deaa",
  "3f24e38734da5e1be049345f611dc956ce6351bcfda6b36210e342fa356ffbd0",
  "ccca937c293806f2d535b38b4d2a347cfac9ef5d7f8649695a95ff4c9d89f1df"
];
const TIMEOUT = 120000; // 120.000 ms = 2 menit

let keyIndex = 0;

// Helper functions
const roundTo16 = (x) => Math.max(16, Math.round(parseInt(x) / 16) * 16);
const validateParams = ({ prompt, width = 1024, height = 1024, steps = 3, n = 1 }) => ({
  prompt: prompt?.trim(),
  width: roundTo16(width),
  height: roundTo16(height),
  steps: Math.min(Math.max(parseInt(steps), 1), 4),
  n: Math.min(Math.max(parseInt(n), 1), 4)
});

// Async error middleware
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch((err) =>
    res.status(500).json({ error: { message: err.message } })
  );

// === API Routes ===
app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.post(
  "/api/generate-image",
  asyncHandler(async (req, res) => {
    const { prompt, width, height, steps, n } = validateParams(req.body);
    if (!prompt) return res.status(400).json({ error: { message: "Prompt required" } });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT);

    try {
      const response = await fetch("https://api.together.ai/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEYS[keyIndex]}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "black-forest-labs/FLUX.1-schnell-Free",
          prompt,
          width,
          height,
          steps,
          n,
          response_format: "url"
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);
      const data = await response.json();

      if (response.status === 429 || data.error?.type === "model_rate_limit") {
        keyIndex = (keyIndex + 1) % API_KEYS.length;
        return res.redirect(req.originalUrl);
      }

      if (!data.data?.[0]?.url) {
        return res.status(500).json({ error: { message: "Failed to generate image" } });
      }

      res.json({ data: data.data });
    } catch (err) {
      clearTimeout(timeout);
      throw err.name === "AbortError" ? new Error("Timeout on TogetherAI request") : err;
    }
  })
);

app.get(
  "/api/check-togetherai",
  asyncHandler(async (req, res) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch("https://api.together.ai/status", {
        headers: { Authorization: `Bearer ${API_KEYS[keyIndex]}` },
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return res.status(response.status).json({
          error: { message: `TogetherAI not responding: ${response.statusText}` }
        });
      }

      const data = await response.json();
      res.json({ message: "Connected to TogetherAI", data });
    } catch (err) {
      clearTimeout(timeout);
      throw err.name === "AbortError" ? new Error("Timeout") : err;
    }
  })
);

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Export for serverless
export const handler = serverless(app);

// Run server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});