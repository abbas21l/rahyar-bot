// api/relay.js
// پل بی‌حافظه بین سایت و تلگرام.
//
// چرا این شکلی: هاست سایت ورودی از دیتاسنترهای خارجی را بلاک می‌کند (BitNinja)،
// پس Vercel نمی‌تواند به سایت وصل شود. ولی خروجی سایت باز است.
// راه‌حل: سایت خودش هر دقیقه از اینجا می‌پرسد و جواب‌ها را می‌فرستد.
// هیچ صف و حافظه‌ای اینجا نگه داشته نمی‌شود — تلگرام خودش صف دارد.
//
// متغیرهای محیطی: BOT_TOKEN · RELAY_KEY
//
// عملیات (همه POST با هدر X-Relay-Key):
//   {"action":"pull","offset":123}                 → پیام‌های تازه
//   {"action":"send","chat_id":1,"text":"..."}     → ارسال پیام
//   {"action":"me"}                                → تست سلامت
//   {"action":"fetch","url":"https://..."}         → واکشی منبعی که مستقیم بسته است

const BOT_TOKEN = process.env.BOT_TOKEN;
const RELAY_KEY = process.env.RELAY_KEY || "";
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

const MENU = {
  keyboard: [
    [{ text: "ورود به سایت" }, { text: "وضعیت من" }],
    [{ text: "راهنما" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

async function tg(method, body) {
  const r = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "post_only" });
  }
  if (!RELAY_KEY || req.headers["x-relay-key"] !== RELAY_KEY) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  if (!BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: "no_bot_token" });
  }

  const body = req.body || {};
  const action = String(body.action || "");

  try {
    // ─── سلامت ───
    if (action === "me") {
      const d = await tg("getMe");
      return res.status(200).json({ ok: !!d.ok, bot: d.result?.username || null });
    }

    // ─── گرفتن پیام‌های تازه ───
    if (action === "pull") {
      const offset = Number(body.offset || 0);
      const d = await tg("getUpdates", {
        offset: offset > 0 ? offset + 1 : undefined,
        timeout: 0,
        limit: 20,
        allowed_updates: ["message"],
      });

      if (!d.ok) {
        return res.status(200).json({ ok: false, error: d.description || "getUpdates failed" });
      }

      const messages = [];
      let maxId = offset;

      for (const u of d.result || []) {
        if (u.update_id > maxId) maxId = u.update_id;
        const m = u.message;
        if (!m || !m.chat) continue;
        messages.push({
          update_id: u.update_id,
          chat_id: m.chat.id,
          telegram_id: String(m.from?.id || m.chat.id),
          name: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(" ") || "رهجو",
          username: m.from?.username || "",
          text: (m.text || "").trim(),
          date: m.date,
        });
      }

      return res.status(200).json({ ok: true, offset: maxId, messages });
    }

    // ─── فرستادن پیام ───
    if (action === "send") {
      const chatId = body.chat_id;
      const text = String(body.text || "");
      if (!chatId || !text) {
        return res.status(400).json({ ok: false, error: "chat_id and text required" });
      }
      const d = await tg("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        reply_markup: body.menu === false ? undefined : MENU,
      });
      return res.status(200).json({ ok: !!d.ok, error: d.description || null });
    }

    // ─── واکشی از طرف سایت ───
    // چند منبع (مثل Cloudflare) درخواست مستقیم سرور ایران را ۴۰۳ می‌دهند.
    // اینجا از سمت Vercel گرفته می‌شود و خام برگردانده می‌شود.
    if (action === "fetch") {
      const url = String(body.url || "");
      if (!/^https?:\/\//i.test(url)) {
        return res.status(400).json({ ok: false, error: "bad_url" });
      }
      const t0 = Date.now();
      const r = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          "Accept":
            "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, text/html;q=0.8, */*;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
      let text = await r.text();
      const truncated = text.length > 900000;
      if (truncated) text = text.slice(0, 900000);
      return res.status(200).json({
        ok: r.ok,
        status: r.status,
        ms: Date.now() - t0,
        truncated,
        body: text,
      });
    }

    // ─── ارسال دسته‌ای ───
    if (action === "send_many") {
      const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
      const results = [];
      for (const it of items) {
        if (!it.chat_id || !it.text) continue;
        const d = await tg("sendMessage", {
          chat_id: it.chat_id,
          text: String(it.text),
          parse_mode: "HTML",
          disable_web_page_preview: true,
          reply_markup: MENU,
        });
        results.push({ chat_id: it.chat_id, ok: !!d.ok });
      }
      return res.status(200).json({ ok: true, sent: results.length, results });
    }

    return res.status(400).json({ ok: false, error: "unknown_action" });
  } catch (e) {
    console.error("[relay]", e);
    return res.status(500).json({ ok: false, error: String(e).slice(0, 200) });
  }
}
