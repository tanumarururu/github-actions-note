import { chromium } from "playwright";
import { marked } from "marked";
import fs from "fs";
import path from "path";

const STATE_PATH = process.env.STATE_PATH;
const IS_PUBLIC = String(process.env.IS_PUBLIC || "false") === "true";
const START_URL = process.env.START_URL || "https://editor.note.com/new";

const md = fs.readFileSync(".note-artifacts/article.md", "utf8");
const titleMatch = md.match(/^#\s*(.+)/);
const title = titleMatch ? titleMatch[1].trim() : "タイトル（自動生成）";

// ====== Cookie修正（.note.com → .editor.note.com対応）======
let storage;
try {
  storage = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  if (Array.isArray(storage.cookies)) {
    const extra = storage.cookies
      .filter(c => (c.domain || "").includes("note.com"))
      .map(c => ({ ...c, domain: ".editor.note.com" }));
    storage.cookies.push(...extra);
    fs.writeFileSync(STATE_PATH, JSON.stringify(storage, null, 2));
  }
} catch (e) {
  console.log("⚠️ STATE_PATH読み込み失敗:", e.message);
}

// ====== ブラウザ起動 ======
const browser = await chromium.launch({
  headless: true,
  args: ["--lang=ja-JP", "--disable-blink-features=AutomationControlled"],
});
const context = await browser.newContext({
  storageState: STATE_PATH,
  locale: "ja-JP",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36",
});
const page = await context.newPage();

// ====== スクショ保存関数 ======
const ssDir = ".note-artifacts";
fs.mkdirSync(ssDir, { recursive: true });
const ss = async (page, name) => {
  const p = path.join(ssDir, `debug-${Date.now()}-${name}.png`);
  try {
    await page.screenshot({ path: p, fullPage: true });
    console.log(`[🖼] Screenshot saved: ${p}`);
  } catch {
    console.log("⚠️ Screenshot failed");
  }
};

// ====== Noteエディタ起動 ======
try {
  console.log("[info] Opening:", START_URL);
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 });

  // ===== ログイン検知 =====
  if (/\/login/i.test(page.url())) {
    console.log("⚠️ ログインページにリダイレクトされました。セッション再適用中...");
    try {
      await page.context().clearCookies();
      if (storage?.cookies?.length) {
        await context.addCookies(storage.cookies);
      }
    } catch (e) {
      console.log("cookie再適用エラー:", e.message);
    }
    await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  console.log("[info] Current URL:", page.url());

  // ===== タイトル入力欄検出（60秒） =====
  await Promise.race([
    page.waitForSelector('textarea[placeholder*="タイトル"]', { timeout: 60000 }),
    page.waitForSelector('textarea[aria-label*="タイトル"]', { timeout: 60000 }),
  ]).catch(async () => {
    console.log("⚠️ タイトル入力欄が見つかりません。スクショを保存します。");
    await ss(page, "no-title");
    throw new Error("タイトル欄が見つからない（ログイン切れorUI変更）");
  });

  await page.fill('textarea[placeholder*="タイトル"]', title).catch(async () => {
    await page.fill('textarea[aria-label*="タイトル"]', title);
  });

  // ===== 本文入力 =====
  const bodyBox = page.locator('div[contenteditable="true"][role="textbox"]').first();
  await bodyBox.waitFor({ state: "visible", timeout: 60000 });
  await bodyBox.click();
  await page.evaluate(async (text) => {
    const item = new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
  }, md);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");

  // ===== 下書き保存モード =====
  if (!IS_PUBLIC) {
    const saveBtn = page.locator('button:has-text("下書き保存")').first();
    await saveBtn.waitFor({ state: "visible", timeout: 60000 });
    for (let i = 0; i < 20; i++) {
      if (await saveBtn.isEnabled()) break;
      await page.waitForTimeout(200);
    }
    await saveBtn.click({ force: true });
    console.log("✅ 下書き保存完了");
    await ss(page, "saved-draft");
    await browser.close();
    process.exit(0);
  }

  // ===== 公開処理 =====
  const proceed = page.locator('button:has-text("公開に進む")').first();
  await proceed.waitFor({ state: "visible", timeout: 60000 });
  await proceed.click({ force: true });

  const publishBtn = page.locator('button:has-text("投稿する")').first();
  await publishBtn.waitFor({ state: "visible", timeout: 60000 });
  await publishBtn.click({ force: true });

  console.log("✅ 公開投稿完了");
  await ss(page, "published");

} catch (e) {
  console.log("❌ エラー:", e.message);
  await ss(page, "error");
  throw e;
} finally {
  await browser.close();
}
