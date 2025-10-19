import { chromium } from "playwright";
import fs from "fs";

const STATE_PATH = process.env.STATE_PATH;
const IS_PUBLIC  = String(process.env.IS_PUBLIC || "false") === "true";
const START_URL  = process.env.START_URL || "https://editor.note.com/new";
const md         = fs.readFileSync(".note-artifacts/article.md", "utf8");
const titleMatch = md.match(/^#\s*(.+)/);
const title      = titleMatch ? titleMatch[1] : "タイトル（自動生成）";

// --- Cookie補完 ---
let storage = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
if (Array.isArray(storage.cookies)) {
  const domains = [".note.com", "note.com", ".editor.note.com", "editor.note.com"];
  const extra = [];
  for (const c of storage.cookies) {
    if (!String(c.domain).includes("note.com")) continue;
    for (const d of domains) {
      if (c.domain === d) continue;
      extra.push({ ...c, domain: d });
    }
  }
  storage.cookies.push(...extra);
  fs.writeFileSync(STATE_PATH, JSON.stringify(storage, null, 2));
}

const browser = await chromium.launch({
  headless: true,
  args: ["--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu"]
});

const context = await browser.newContext({
  storageState: STATE_PATH,
  locale: "ja-JP",
  viewport: { width: 1280, height: 900 }
});

const page = await context.newPage();

console.log("🚀 noteエディタを開きます...");
await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 90000 });

// --- ログイン確認 ---
if (page.url().includes("/login")) {
  console.log("⚠️ ログイン再適用");
  await context.clearCookies();
  await context.addCookies(storage.cookies);
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
}

await page.waitForTimeout(3000);

// --- タイトル入力欄を検索 ---
const titleSelectors = [
  'div[contenteditable="true"][data-placeholder*="タイトル"]',
  'div[role="textbox"][contenteditable="true"]',
  'textarea[placeholder*="タイトル"]',
  'div[contenteditable="true"] h1',
  'h1[contenteditable="true"]'
];

let titleBox = null;
for (const sel of titleSelectors) {
  try {
    const box = await page.$(sel);
    if (box) {
      titleBox = box;
      console.log(`✅ タイトル欄検出: ${sel}`);
      break;
    }
  } catch {}
}

if (!titleBox) {
  await page.screenshot({ path: ".note-artifacts/error_title.png", fullPage: true });
  throw new Error("❌ タイトル欄が見つかりません。UI変更の可能性あり。");
}

await titleBox.click({ clickCount: 3 });
await page.keyboard.press("Backspace");
await titleBox.type(title);
console.log("✅ タイトル入力完了:", title);

// --- 本文入力欄 ---
const bodySelectors = [
  'div[contenteditable="true"]:not([data-placeholder*="タイトル"])',
  'article div[contenteditable="true"]',
  'div[data-testid*="editor"] div[contenteditable="true"]'
];

let bodyBox = null;
for (const sel of bodySelectors) {
  try {
    const box = await page.$(sel);
    if (box) {
      bodyBox = box;
      console.log(`✅ 本文欄検出: ${sel}`);
      break;
    }
  } catch {}
}

if (!bodyBox) {
  await page.screenshot({ path: ".note-artifacts/error_body.png", fullPage: true });
  throw new Error("❌ 本文欄が見つかりません。");
}

await bodyBox.click();
await page.keyboard.type(md.slice(0, 5000));
console.log("✅ 本文入力完了");

// --- 下書き or 公開 ---
if (!IS_PUBLIC) {
  try {
    const saveBtn = page.locator('button:has-text("下書き保存")').first();
    if (await saveBtn.isVisible()) {
      await saveBtn.click();
      console.log("✅ 下書き保存完了");
    } else {
      console.log("⚠️ 自動保存モード検出");
    }
  } catch {
    console.log("⚠️ 自動保存モード検出");
  }
  await browser.close();
  process.exit(0);
}

// --- 公開 ---
try {
  const proceed = page.locator('button:has-text("公開に進む")').first();
  await proceed.waitFor({ state: "visible", timeout: 60000 });
  await proceed.click();

  const publishBtn = page.locator('button:has-text("投稿する")').first();
  await publishBtn.waitFor({ state: "visible", timeout: 60000 });
  await publishBtn.click();
  console.log("✅ 公開投稿完了");
} catch (e) {
  await page.screenshot({ path: ".note-artifacts/error_publish.png", fullPage: true });
  throw e;
}

await browser.close();
