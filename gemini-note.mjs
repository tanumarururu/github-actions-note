// gemini-note.mjs
// ----------------------
// Gemini APIで記事を自動生成するサンプル
// ----------------------

import fetch from "node-fetch";

// 環境変数からAPIキーを取得
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// Geminiエンドポイント
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro-latest:generateContent?key=${GEMINI_API_KEY}`;

// 記事生成用プロンプト
const prompt = `
テーマ：${process.env.THEME || "AIでnoteを自動投稿する方法"}
読者：${process.env.TARGET || "初心者"}
メッセージ：${process.env.MESSAGE || "Gemini APIを使えば無料で自動化できる！"}
タグ：${process.env.TAGS || "Gemini,note,自動化"}

上記をもとに、note記事をMarkdown形式で生成してください。
`;

// APIリクエスト
const response = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    tools: [{ type: "google_search" }] // ClaudeのWebSearch相当
  })
});

// レスポンス処理
const data = await response.json();

// 結果をコンソールに出力
const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "出力なし";
console.log("=== Gemini出力 ===\n", text);

// 結果を次のジョブに渡すために保存（Actions間連携）
import fs from "fs";
fs.writeFileSync("article.md", text);
