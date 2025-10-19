import { chromium } from "playwright";
import { marked } from "marked";
import fs from "fs";

const STATE_PATH = process.env.STATE_PATH;
const IS_PUBLIC = String(process.env.IS_PUBLIC || "false") === "true";
const START_URL = process.env.START_URL || "https://editor.note.com/new";

const md = fs.readFileSync(".note-artifacts/article.md", "utf8");
const titleMatch = md.match(/^#\s*(.+)/);
const title = titleMatch ? titleMatch[1] : "タイトル（自動生成）";

// --- Cookie修正 ---
let storage = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
if (Array.isArray(storage.cookies)) {
  const extraDomains = [".note.com", "note.com", ".editor.note.com"];
  const extraCookies = storage.cookies.flatMap((c) =>
    extraDomains
      .filter((d) => !c.domain.includes(d))
      .map((d) => ({ ...c, domain: d }))
  );
  storage.cookies.push(...extraCookies);
  fs.writeFileSync(STATE_PATH, JSON.stringify(storage, null, 2));
}

// --- Browser起動 ---
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ storageState: STATE_PATH });
const page = await context.newPage();

await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 90000 });

// --- ログイン確認 ---
if (page.url().includes("/login")) {
  console.log("⚠️ ログイン再適用を実行します");
  await context.clearCookies();
  await context.addCookies(storage.cookies);
  await page.goto(START_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
}

// --- タイトル欄（旧UI / 新UI どちらも対応） ---
let titleBox = null;
try {
  await page.waitForTimeout(3000);
  // 旧UI
  titleBox = await page.$('textarea[placeholder*="タイトル"]');
  // 新UI
  if (!titleBox) {
    titleBox = await page.$('div[contenteditable="true"][data-placeholder*="タイトル"]');
  }
  // fallback
  if (!titleBox) {
    const editors = await page.$$(`div[contenteditable="true"]`);
    titleBox = editors[0];
  }

  if (!titleBox) throw new Error("タイトル欄が見つかりませんでした");
  await titleBox.click({ clickCount: 3 });
  await titleBox.press("Backspace");
  await titleBox.type(title);
  console.log("✅ タイトル入力完了:", title);
} catch (e) {
  console.error("❌ タイトル入力失敗:", e.message);
  await page.screenshot({ path: ".note-artifacts/error_title.png", fullPage: true });
  await browser.close();
  process.exit(1);
}

// --- 本文欄 ---
try {
  let bodyBox = null;
  const boxes = await page.$$(`div[contenteditable="true"]`);
  if (boxes.length > 1) {
    bodyBox = boxes[1];
  } else {
    // Fallback: role=articleなどを含むもの
    bodyBox = await page.$('div[role="textbox"], div[aria-label*="本文"]');
  }

  if (!bodyBox) throw new Error("本文欄が見つかりませんでした");
  await bodyBox.click();
  await page.keyboard.type(md.slice(0, 5000));
  console.log("✅ 本文入力完了");
} catch (e) {
  console.error("❌ 本文入力失敗:", e.message);
  await page.screenshot({ path: ".note-artifacts/error_body.png", fullPage: true });
  await browser.close();
  process.exit(1);
}

// --- 下書き or 公開 ---
try {
  if (!IS_PUBLIC) {
    console.log("✅ 自動下書き保存モード（新UI対応）");
    await page.waitForTimeout(4000);
  } else {
    const publishBtns = await page.$$(`button, div[role="button"]`);
    let target = null;
    for (const b of publishBtns) {
      const txt = (await b.innerText().catch(() => ""))?.trim();
      if (txt && (txt.includes("公開") || txt.includes("投稿"))) {
        target = b;
        break;
      }
    }
    if (target) {
      await target.click();
      console.log("✅ 公開投稿完了");
    } else {
      throw new Error("公開ボタンが見つかりません");
    }
  }
} catch (e) {
  console.error("❌ 投稿処理失敗:", e.message);
  await page.screenshot({ path: ".note-artifacts/error_publish.png", fullPage: true });
}

await browser.close();
