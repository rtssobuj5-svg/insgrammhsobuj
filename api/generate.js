export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { base64Data, mimeType, prompt, responseSchema, tools } = req.body;

  // 5টা key env variable থেকে নেবে (Vercel দেখুন → Project → Settings → Environment Variables)
  const keys = [
    process.env.GEMINI_KEY_1,
    process.env.GEMINI_KEY_2,
    process.env.GEMINI_KEY_3,
    process.env.GEMINI_KEY_4,
    process.env.GEMINI_KEY_5,
  ].filter(Boolean); // খালি থাকলে বাদ

  if (keys.length === 0) {
    return res.status(500).json({ error: "No API keys configured on server" });
  }

  let lastError = null;

  // একটা key দিয়ে চেষ্টা করবে, rate-limit/fail হলে পরের key try করবে
  for (const key of keys) {
    try {
      // image/video ছাড়াও (text-only) call করা যায় এখন — base64Data/mimeType
      // না থাকলে শুধু text part পাঠানো হবে (Trending Ideas, Shadowban Checker,
      // Story Ideas, Weather-based Ideas — এসবের জন্য কোনো ছবি লাগে না)
      const parts = [{ text: prompt }];
      if (base64Data && mimeType) {
        parts.push({ inline_data: { mime_type: mimeType, data: base64Data } });
      }

      const body = { contents: [{ parts }] };

      // structured JSON output চাইলে schema পাঠানো হয় (আগের মতোই)
      if (responseSchema) {
        body.generationConfig = {
          responseMimeType: "application/json",
          responseSchema: responseSchema
        };
      }

      // Google Search grounding চাইলে (Trending Ideas feature) — এটা আর
      // responseSchema একসাথে ব্যবহার করা যায় না (Gemini API-র সীমাবদ্ধতা),
      // তাই client-side থেকে এই দুটোর মধ্যে যেকোনো একটাই পাঠানো হবে।
      if (tools) {
        body.tools = tools;
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }
      );

      if (response.status === 429) {
        // এই key-র quota শেষ, পরের key try করবে
        lastError = "Rate limited on one key, trying next...";
        continue;
      }

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        lastError = errJson?.error?.message || `Error ${response.status}`;
        continue;
      }

      const data = await response.json();
      return res.status(200).json(data);

    } catch (e) {
      lastError = e.message;
      continue;
    }
  }

  // সব key fail করলে
  return res.status(500).json({ error: lastError || "All API keys failed" });
}
