import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import serverless from "serverless-http";

const app = express();
app.use(cors());
app.use(express.json());

const API_KEYS = [
  "bd387d9ec32783f00020a0b3dc2da01ee150580bb62cde657f600d9a9ac1deaa",
  "3f24e38734da5e1be049345f611dc956ce6351bcfda6b36210e342fa356ffbd0",
  "ccca937c293806f2d535b38b4d2a347cfac9ef5d7f8649695a95ff4c9d89f1df"
];

let keyIndex = 0;
const TIMEOUT = 9500;

// Helper untuk pembulatan ke kelipatan 16
function roundTo16(x) {
  return Math.max(16, Math.round(x / 16) * 16);
}

// === ROUTES ===

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/generate-image", async (req, res) => {
  const { prompt, width = 1024, height = 1024, steps = 3, n = 1 } = req.body;

  const w = roundTo16(parseInt(width));
  const h = roundTo16(parseInt(height));
  const s = Math.min(Math.max(parseInt(steps), 1), 4);
  const count = Math.min(Math.max(parseInt(n), 1), 4);

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
        width: w,
        height: h,
        steps: s,
        n: count,
        response_format: "url"
      }),
      signal: controller.signal
    });

    clearTimeout(timeout);
    const data = await response.json();

    // Jika rate limit, coba key berikutnya
    if (response.status === 429 || data.error?.type === "model_rate_limit") {
      keyIndex = (keyIndex + 1) % API_KEYS.length;
      return await app.handle(req, res); // retry
    }

    if (!data.data?.[0]?.url) {
      return res.status(500).json({ error: { message: "Gagal mendapatkan gambar dari TogetherAI" } });
    }

    res.json({ data: data.data });
  } catch (err) {
    clearTimeout(timeout);
    const msg = err.name === "AbortError" ? "Timeout saat request ke TogetherAI" : err.message;
    res.status(500).json({ error: { message: msg } });
  }
});

// === EXPORT UNTUK SERVERLESS ===
export const handler = serverless(app);

// === LOCAL MODE === (khusus ESM)
if (import.meta.url === `file://${process.argv[1]}`) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`🚀 Server lokal berjalan di http://localhost:${PORT}`);
  });
}
