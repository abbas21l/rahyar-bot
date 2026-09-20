// api/webhook.js
// ربات رهیار — وب‌هوک تلگرام
// روی Vercel می‌نشیند چون از سرور ایران، دامنهٔ تلگرام در دسترس نیست.
// با سایت فقط از طریق bot_api.php حرف می‌زند و کلید مشترک می‌فرستد.
//
// متغیرهای محیطی لازم در Vercel:
//   BOT_TOKEN   توکنی که BotFather داده
//   SITE_URL    https://abbasramezani.com
//   BOT_KEY     همان مقدار settings.bot_shared_key در سایت
//   WEBHOOK_SECRET  یک رشتهٔ تصادفی؛ تلگرام آن را در هدر می‌فرستد

const BOT_TOKEN = process.env.BOT_TOKEN;
const SITE_URL = (process.env.SITE_URL || "https://abbasramezani.com").replace(/\/$/, "");
const BOT_KEY = process.env.BOT_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";

const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function send(chatId, text, keyboard) {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  };
  if (keyboard) {
    body.reply_markup = { keyboard, resize_keyboard: true, is_persistent: true };
  }
  const r = await fetch(`${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error("[tg] send failed", r.status, await r.text());
}

// تماس با سایت
async function site(action, payload) {
  const r = await fetch(`${SITE_URL}/bot_api.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Key": BOT_KEY },
    body: JSON.stringify({ action, ...payload }),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    console.error("[site] bad response", r.status, text.slice(0, 300));
    return { ok: false, error: "bad_response" };
  }
}

const MENU = [
  [{ text: "ورود به سایت" }, { text: "وضعیت من" }],
  [{ text: "راهنما" }],
];

const HELP = `<b>رهیار</b> همراه تصمیم‌های مدیریتی توست.

اینجا سه کار می‌توانی بکنی:

• <b>ورود به سایت</b> — کد یک‌بارمصرف می‌گیری و بدون رمز وارد می‌شوی
• <b>وضعیت من</b> — می‌بینی کجای مسیری و چه چیزی ناتمام مانده
• هر اتفاق مهمی که در کارت افتاد همین‌جا بنویس — تغییر تیم، افت فروش، پروژهٔ تازه. همان‌ها هستند که باعث می‌شوند توصیه‌ها به کار واقعی‌ات بخورد.

محتوا و تمرین‌ها در سایت است: ${SITE_URL}/course.php`;

function fmtStatus(s) {
  const lines = [`<b>${s.name || "رهجو"}</b>`];

  if (s.modules && s.modules.length) {
    const done = s.modules.filter((m) => ["submitted", "completed"].includes(m.state)).length;
    lines.push(`\n📘 ${done} فصل از ${s.modules.length} تمام شده`);
    for (const m of s.modules) {
      const icon = ["submitted", "completed"].includes(m.state) ? "✓" : m.state === "in_progress" ? "◐" : "○";
      lines.push(`${icon} ${m.name_fa}`);
    }
  } else {
    lines.push("\nهنوز فصلی را شروع نکرده‌ای.");
    lines.push(`فصل اول رایگان است: ${SITE_URL}/course.php`);
  }

  if (s.pending_exercises && s.pending_exercises.length) {
    lines.push(`\n⏳ ${s.pending_exercises.length} تمرین لازم هنوز ناتمام است`);
  }

  if (s.profile && s.profile.dominant_style) {
    const styles = {
      directive: "دستوری",
      consultative: "مشورتی",
      delegative: "تفویضی",
      consensus: "اجماعی",
    };
    lines.push(`\n🧭 سبک غالبت: ${styles[s.profile.dominant_style] || s.profile.dominant_style}`);
  } else {
    lines.push(`\nسنجش موقعیتی را هنوز انجام نداده‌ای: ${SITE_URL}/profile.php`);
  }

  return lines.join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("ok");

  // فقط تلگرام، با سکرت وب‌هوک
  if (WEBHOOK_SECRET) {
    const got = req.headers["x-telegram-bot-api-secret-token"];
    if (got !== WEBHOOK_SECRET) return res.status(401).send("no");
  }

  const update = req.body || {};
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return res.status(200).send("ok");

  const chatId = msg.chat.id;
  const tgId = String(msg.from?.id || chatId);
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ") || "رهجو";
  const username = msg.from?.username || "";
  const text = (msg.text || "").trim();

  // پاسخ فوری به تلگرام؛ کار بعدش انجام می‌شود
  res.status(200).send("ok");

  try {
    // هر تماسی اول حساب را می‌سازد یا وصل می‌کند
    const linked = await site("link", { telegram_id: tgId, name, username });
    if (!linked.ok) {
      await send(chatId, "ارتباط با سایت برقرار نشد. کمی بعد دوباره امتحان کن.");
      return;
    }

    if (text === "/start" || text === "شروع") {
      const hello = linked.created
        ? `سلام ${name}.\n\nاز این به بعد پرونده‌ات اینجا وصل است. فصل اول دوره رایگان است و برای خواندنش ورود لازم نیست:\n${SITE_URL}/course.php\n\nهر وقت خواستی تمرین بفرستی، از همین‌جا کد ورود بگیر.`
        : `سلام ${name}. برگشتی.\n\nبرای ورود به سایت دکمهٔ «ورود به سایت» را بزن.`;
      await send(chatId, hello, MENU);
      return;
    }

    if (text === "راهنما" || text === "/help") {
      await send(chatId, HELP, MENU);
      return;
    }

    if (text === "ورود به سایت" || text === "ورود" || text === "/login") {
      const r = await site("code", { telegram_id: tgId });
      if (!r.ok) {
        await send(chatId, "کد ساخته نشد. کمی بعد دوباره امتحان کن.");
        return;
      }
      await send(
        chatId,
        `کد ورود تو:\n\n<code>${r.code}</code>\n\nیا مستقیم وارد شو:\n${r.url}\n\nپانزده دقیقه اعتبار دارد و یک بار کار می‌کند.`,
        MENU
      );
      return;
    }

    if (text === "وضعیت من" || text === "وضعیت" || text === "/status") {
      const s = await site("status", { telegram_id: tgId });
      if (!s.ok) {
        await send(chatId, "وضعیت خوانده نشد. کمی بعد دوباره امتحان کن.");
        return;
      }
      await send(chatId, fmtStatus(s), MENU);
      return;
    }

    // هر چیز دیگر: رویداد
    if (text.length >= 10) {
      const title = text.length > 90 ? text.slice(0, 90) + "…" : text;
      const r = await site("event", { telegram_id: tgId, title, body: text });
      await send(
        chatId,
        r.ok
          ? "ثبت شد. همین‌ها هستند که باعث می‌شوند توصیه‌های بعدی به کار واقعی‌ات بخورد."
          : "ثبت نشد. کمی بعد دوباره بفرست.",
        MENU
      );
      return;
    }

    if (text) {
      await send(chatId, "متوجه نشدم. از دکمه‌های پایین استفاده کن یا «راهنما» را بزن.", MENU);
    }
  } catch (e) {
    console.error("[webhook]", e);
    try {
      await send(chatId, "خطایی پیش آمد. کمی بعد دوباره امتحان کن.");
    } catch {}
  }
}
