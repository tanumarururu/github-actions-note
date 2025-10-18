import { chromium } from "playwright";
import { marked } from "marked";
import fs from "fs";

const STATE_PATH = process.env.STATE_PATH;
const IS_PUBLIC = String(process.env.IS_PUBLIC || "false") === "true";
const START_URL = process.env.START_URL || "https://editor.note.com/new";
const md = fs.readFileSync(".note-artifacts/article.md", "utf8");
const html = marked.parse(md);

const titleMatch = md.match(/^#\s*(.+)/);
const title = titleMatch ? titleMatch[1] : "タイトル（自動生成）";

// --- セッション修正処理 ---
let storage = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
if (storage.cookies) {
  const editorCookies = storage.cookies
    .filter(c => c.domain.includes("note.com"))
    .map(c => ({ ...c, domain: ".editor.note.com" }));
  storage.cookies.push(...editorCookies);
  fs.writeFileSync(STATE_PATH, JSON.stringify(storage, null, 2));
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: STATE_PATH });
const page = await context.newPage();

await page.goto(START_URL, { waitUntil: "domcontentloaded" });

// --- ログイン検知 ---
if (page.url().includes("login")) {
  console.log("⚠️ ログインページにリダイレクトされました。セッション適用再試行中…");
  await page.context().clearCookies();
  await context.addCookies(storage.cookies);
  await page.goto(START_URL, { waitUntil: "domcontentloaded" });
}

await page.waitForSelector('textarea[placeholder*="タイトル"]', { timeout: 60000 });
await page.fill('textarea[placeholder*="タイトル"]', title);

const bodyBox = page.locator('div[contenteditable="true"][role="textbox"]').first();
await bodyBox.waitFor({ state: "visible" });
await bodyBox.click();
await page.keyboard.type(md.slice(0, 5000));

if (!IS_PUBLIC) {
  const saveBtn = page.locator('button:has-text("下書き保存")').first();
  await saveBtn.waitFor({ state: "visible" });
  if (await saveBtn.isEnabled()) await saveBtn.click();
  console.log("✅ 下書き保存完了");
  await browser.close();
  process.exit(0);
}

const proceed = page.locator('button:has-text("公開に進む")').first();
await proceed.waitFor({ state: "visible" });
await proceed.click();

const publishBtn = page.locator('button:has-text("投稿する")').first();
await publishBtn.waitFor({ state: "visible" });
await publishBtn.click();

console.log("✅ 公開投稿完了");
await browser.close();
