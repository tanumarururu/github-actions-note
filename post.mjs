cat > post.mjs <<'EOF'
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
const domains = [".note.com", "note.com", ".editor.note.com", "editor.note.com"];
if (Array.isArray(storage.cookies)) {
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

// --- Playwright起動 ---
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
console.log("🚀 noteエディタを開いています...");
await page.goto(START_URL, { waitUntil: "networkidle", timeout: 120000 });

// --- ログイン確認 ---
if (page.url().includes("/login")) {
  console.log("⚠️ ログイン再適用中...");
  await context.clearCookies();
  await context.addCookies(storage.cookies);
  await page.goto(START_URL, { waitUntil: "networkidle", timeout: 120000 });
}

// --- ページ安定化 ---
await page.waitForTimeout(5000);

// --- タイトル欄検出ロジック（最新版UI対応） ---
const titleSelectors = [
  'textarea[placeholder*="タイトル"]',
  'input[placeholder*="タイトル"]',
  'div[contenteditable="true"][data-placeholder*="タイトル"]',
  'div[contenteditable="true"][role="textbox"]',
  'h1[contenteditable="true"]',
  'div[data-testid*="title"]',
  '[data-slate-node="element"] h1',
  'div[role="textbox"]:not([aria-label*="本文"])'
];

let titleBox = null;
for (const sel of titleSelectors) {
  try {
    const box = await page.waitForSelector(sel, { timeout: 8000 });
    if (box) {
      titleBox = box;
      console.log(`✅ タイトル欄検出: ${sel}`);
      break;
    }
  } catch {}
}

if (!titleBox) {
  console.error("❌ タイトル欄が見つかりません（UI変更の可能性）");
  await page.screenshot({ path: ".note-artifacts/error_title.png", fullPage: true });
  await browser.close();
  process.exit(1);
}

// --- タイトル入力 ---
await titleBox.click({ clickCount: 3 });
await page.keyboard.press("Backspace");
await titleBox.type(title, { delay: 30 });
console.log("✅ タイトル入力完了:", title);

// --- 本文欄検出 ---
const bodySelectors = [
  'div[contenteditable="true"]:not([data-placeholder*="タイトル"])',
  'div[role="textbox"][data-placeholder*="本文"]',
  'article div[contenteditable="true"]',
  'div[data-testid*="editor-body-input"]',
  'div[data-testid*="rich-text"]'
];

let bodyBox = null;
for (const sel of bodySelectors) {
  try {
    const box = await page.waitForSelector(sel, { timeout: 8000 });
    if (box) {
      bodyBox = box;
      console.log(`✅ 本文欄検出: ${sel}`);
      break;
    }
  } catch {}
}

if (!bodyBox) {
  console.error("❌ 本文欄が見つかりません（UI変更の可能性）");
  await page.screenshot({ path: ".note-artifacts/error_body.png", fullPage: true });
  await browser.close();
  process.exit(1);
}

// --- 本文入力 ---
await bodyBox.click();
await page.keyboard.type(md.slice(0, 8000), { delay: 10 });
console.log("✅ 本文入力完了");

// --- 保存または公開 ---
if (!IS_PUBLIC) {
  console.log("💾 下書き保存モード");
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

// --- 公開処理 ---
try {
  console.log("🚀 公開ボタン探索中...");
  const proceed = page.locator('button:has-text("公開に進む")').first();
  await proceed.waitFor({ state: "visible", timeout: 60000 });
  await proceed.click();

  const publishBtn = page.locator('button:has-text("投稿する")').first();
  await publishBtn.waitFor({ state: "visible", timeout: 60000 });
  await publishBtn.click();

  console.log("✅ 公開投稿完了");
} catch (e) {
  console.error("❌ 公開処理エラー:", e.message);
  await page.screenshot({ path: ".note-artifacts/error_publish.png", fullPage: true });
}

await browser.close();
EOF
