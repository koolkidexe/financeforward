// Finance Forward website assistant: a Netlify Function that calls the Gemini API.
// Your key lives in Netlify as the environment variable GEMINI_API_KEY and never reaches the browser.
// Optional: set GEMINI_MODEL to change the model (default below).

const MODEL = process.env.GEMINI_MODEL || "gemini-3.7-flash";

const RULES = `You are the friendly website assistant for Finance Forward, a nonprofit that teaches financial literacy to first-generation high school and college students and their families: FAFSA help, net price vs sticker price, budgeting and saving, credit vs debit, taxes, and investing 101.

RULES:
- Answer ONLY from the website content below. Do not invent programs, dates, prices, people, numbers or contact details.
- Parts of the site are still placeholders: Latin "lorem ipsum" text, "Full Name", "20XX", "0,000", "$0.0M", "123 Lorem Street", "hello@example.org", "(000) 000-0000". Treat these as NOT YET AVAILABLE. Never repeat them as facts; say that detail has not been posted yet and suggest the Contact page.
- If the answer is not on the site, say so plainly and point the person to the Contact page.
- You may explain general money terms (FAFSA, grant, loan, net price, budget, credit score, interest, W-4, tax return, index fund, retirement account) in simple words, but say when you are giving general information rather than something from the site. Never give personal financial, tax, investment or legal advice, and never recommend specific investments.
- Only discuss Finance Forward and the money topics it teaches. Politely decline anything unrelated.
- When useful, name the page where they can read more (Home, Our Story, Team, Pathways, Partners, Contact).
- Be warm, brief (2 to 5 short sentences), and use plain language suited to a high-school or college student or a parent. Plain text only, no markdown.`;

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const clip = (s, n) => String(s || "").slice(0, n);

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return json(500, { error: "GEMINI_API_KEY is not set in Netlify" });

  let body;
  try { body = await req.json(); } catch { return json(400, { error: "Bad JSON" }); }

  const question = clip(body.question, 500).trim();
  if (!question) return json(400, { error: "Missing question" });
  const site = clip(body.site, 40000);
  const history = Array.isArray(body.history) ? body.history.slice(-10) : [];

  const contents = history
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: clip(m.content, 2000) }] }));
  contents.push({ role: "user", parts: [{ text: question }] });

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: `${RULES}\n\nWEBSITE CONTENT:\n${site}` }] },
          contents,
          generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
        }),
      }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Gemini error", r.status, JSON.stringify(data).slice(0, 500));
      return json(r.status === 429 ? 429 : 502, { error: "Gemini request failed" });
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const answer = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
    if (!answer) return json(502, { error: "Empty answer" });
    return json(200, { answer });
  } catch (e) {
    console.error(e);
    return json(502, { error: "Could not reach Gemini" });
  }
};
