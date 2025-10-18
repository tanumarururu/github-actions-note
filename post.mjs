import { chromium } from "playwright";
import fs from "fs";
import path from "path";

// 環境変数読み込み
const STATE_JSON = process.env.NOTE_STORAGE_STATE_JSON;
const IS_PUBLIC = process.env.IS_PUBLIC === "true";
const START_URL = "https://note.com/new";

const mdPath = path.resolve("article.md");
const markdown = fs.readFileSync(mdPath, "utf8");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    storageState: JSON.parse(STATE_JSON),
  });
  const page = await context.newPage();

  console.log("🌐 note.com にアクセス中...");
  await page.goto(START_URL, { waitUntil: "networkidle" });

  // ====== 修正版セレクタ部分 ======
  // タイトル入力欄を探す（新UIでは input[placeholder] に変更）
  const titleInput = page.locator('input[placeholder*="タイトル"], textarea[placeholder*="タイトル"]');
  await titleInput.waitFor({ timeout: 60000 });
  console.log("✅ タイトル欄を検出しました");

  // 本文入力欄を探す（新UIでは contenteditable の div に変更）
  const bodyBox = page.locator('div[contenteditable="true"]');
  await bodyBox.waitFor({ timeout: 60000 });
  console.log("✅ 本文エディタを検出しました");

  // タイトル入力
  const titleLine = markdown.split("\n")[0].replace(/^#\s*/, "").slice(0, 60);
  await titleInput.fill(titleLine);
  console.log(`📝 タイトル入力完了: ${titleLine}`);

  // 本文入力
  await bodyBox.click();
  await bodyBox.type(markdown);
  console.log("📄 本文入力完了");

  // 下書き保存 or 公開
  if (!IS_PUBLIC) {
    const saveBtn = page.locator('button:has-text("保存"), button:has-text("下書き")');
    await saveBtn.waitFor({ timeout: 20000 });
    await saveBtn.click();
    console.log("💾 下書き保存完了");
  } else {
    const publishBtn = page.locator('button:has-text("公開")');
    await publishBtn.waitFor({ timeout: 20000 });
    await publishBtn.click();
    console.log("🚀 記事を公開しました");
  }

  await browser.close();
  console.log("🎉 note投稿処理が完了しました");
})();
