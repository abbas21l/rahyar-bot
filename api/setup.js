// api/setup.js
// ثبت وب‌هوک از سمت Vercel، نه از مرورگر.
// توکن ربات هیچ‌وقت در آدرس مرورگر نمی‌افتد و دامنهٔ تلگرام از ایران باز نمی‌شود.
//
// استفاده:  https://<پروژه>.vercel.app/api/setup?key=<WEBHOOK_SECRET>
// حذف وب‌هوک: همان آدرس با &action=delete
// دیدن وضعیت:  همان آدرس با &action=info

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

function page(title, rows, okState) {
  const color = okState === true ? "#1A8B7F" : okState === false ? "#c0392b" : "#8A6D1F";
  const body = rows
    .map(
      ([k, v]) =>
        `<div style="display:flex;gap:14px;padding:11px 0;border-bottom:1px solid rgba(0,0,0,.07)">
           <div style="flex:0 0 160px;opacity:.65">${k}</div>
           <div style="flex:1;word-break:break-all"><code>${v}</code></div>
         </div>`
    )
    .join("");

  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;600&display=swap" rel="stylesheet">
<style>
 body{font-family:Vazirmatn,system-ui,sans-serif;background:#faf9f7;margin:0;padding:40px 20px;line-height:2}
 .box{max-width:720px;margin:0 auto;background:#fff;border:1px solid rgba(0,0,0,.09);
      border-right:5px solid ${color};border-radius:14px;padding:26px}
 h1{font-size:24px;margin:0 0 18px}
 code{font-family:ui-monospace,monospace;font-size:13px;direction:ltr;display:inline-block}
 .hint{font-size:13.5px;opacity:.7;margin-top:20px}
</style></head><body><div class="box"><h1>${title}</h1>${body}
<div class="hint">این صفحه فقط برای راه‌اندازی است. بعد از موفقیت دیگر لازمش نداری.</div>
</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");

  // بدون کلید، هیچ‌کس نمی‌تواند وب‌هوک را عوض کند
  const key = (req.query.key || "").toString();
  if (!WEBHOOK_SECRET || key !== WEBHOOK_SECRET) {
    return res.status(401).send(page("دسترسی ندارید", [["خطا", "کلید درست نیست"]], false));
  }

  if (!BOT_TOKEN) {
    return res
      .status(500)
      .send(page("توکن تنظیم نشده", [["خطا", "BOT_TOKEN در Environment Variables نیست"]], false));
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const webhookUrl = `https://${host}/api/webhook`;
  const action = (req.query.action || "set").toString();

  try {
    // ─── وضعیت فعلی ───
    if (action === "info") {
      const r = await fetch(`${TG}/getWebhookInfo`);
      const d = await r.json();
      const i = d.result || {};
      return res.status(200).send(
        page("وضعیت وب‌هوک", [
          ["آدرس ثبت‌شده", i.url || "— هیچ —"],
          ["در صف مانده", i.pending_update_count ?? 0],
          ["آخرین خطا", i.last_error_message || "— بدون خطا —"],
          ["زمان آخرین خطا", i.last_error_date ? new Date(i.last_error_date * 1000).toISOString() : "—"],
          ["سکرت فعال", i.has_custom_certificate ? "گواهی سفارشی" : "بله"],
        ], !i.last_error_message)
      );
    }

    // ─── حذف ───
    if (action === "delete") {
      const r = await fetch(`${TG}/deleteWebhook?drop_pending_updates=true`);
      const d = await r.json();
      return res
        .status(200)
        .send(page(d.ok ? "وب‌هوک حذف شد" : "حذف نشد", [["پاسخ تلگرام", JSON.stringify(d)]], !!d.ok));
    }

    // ─── ثبت ───
    const r = await fetch(`${TG}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: WEBHOOK_SECRET,
        drop_pending_updates: true,
        allowed_updates: ["message", "edited_message"],
      }),
    });
    const d = await r.json();

    // نام ربات، برای اطمینان از درستی توکن
    let botName = "—";
    try {
      const me = await (await fetch(`${TG}/getMe`)).json();
      if (me.ok) botName = "@" + me.result.username;
    } catch {}

    return res.status(200).send(
      page(d.ok ? "وب‌هوک وصل شد" : "وصل نشد", [
        ["ربات", botName],
        ["آدرس وب‌هوک", webhookUrl],
        ["پاسخ تلگرام", d.description || JSON.stringify(d)],
        ["قدم بعدی", d.ok ? "در تلگرام /start را بزن" : "توکن و آدرس را چک کن"],
      ], !!d.ok)
    );
  } catch (e) {
    return res
      .status(500)
      .send(page("خطا در ارتباط با تلگرام", [["پیام", String(e).slice(0, 300)]], false));
  }
}
