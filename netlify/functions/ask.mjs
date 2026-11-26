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

async function callGemini(key, body) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    }
  );
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

export default async (req) => {
  const key = (process.env.GEMINI_API_KEY || "").trim();

  // Self-test: open https://YOUR-SITE/.netlify/functions/ask in a browser.
  // It never shows the key itself, only whether it is set and whether Gemini accepts it.
  if (req.method === "GET") {
    const report = { functionDeployed: true, keySet: !!key, keyLooksRight: key.startsWith("AIza"), model: MODEL };
    if (!key) return json(200, { ...report, problem: "GEMINI_API_KEY is not set in Netlify, or the site was not redeployed after adding it." });
    try {
      const { r, data } = await callGemini(key, { contents: [{ role: "user", parts: [{ text: "Reply with the word OK." }] }] });
      report.geminiStatus = r.status;
      if (r.ok) report.result = "Gemini answered. The assistant should work.";
      else report.problem = data?.error?.message || "Gemini rejected the request.";
    } catch (e) {
      report.problem = "Could not reach Gemini: " + e.message;
    }
    return json(200, report);
  }

  if (req.method !== "POST") return json(405, { error: "Use POST" });
  if (!key) return json(500, { error: "GEMINI_API_KEY is not set in Netlify", code: "no_key" });

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
    const { r, data } = await callGemini(key, {
      system_instruction: { parts: [{ text: `${RULES}\n\nWEBSITE CONTENT:\n${site}` }] },
      contents,
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    });
    if (!r.ok) {
      console.error("Gemini error", r.status, JSON.stringify(data).slice(0, 500));
      return json(r.status === 429 ? 429 : 502, { error: "Gemini request failed", code: "gemini_" + r.status });
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const answer = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join("").trim();
    if (!answer) return json(502, { error: "Empty answer", code: "empty" });
    return json(200, { answer });
  } catch (e) {
    console.error(e);
    return json(502, { error: "Could not reach Gemini", code: "unreachable" });
  }
};
