import React, { useState, useEffect, useRef, useCallback } from "react";
import { PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

// ── アップロード枠（読み込みはこの6つ）──
const UPLOADS = [
  { id: "sbi_jp",    label: "SBI国内",    color: "#3B82F6" },
  { id: "sbi_us",    label: "SBI海外",    color: "#10B981" },
  { id: "paypay",    label: "PayPay証券", color: "#F59E0B" },
  { id: "bank",      label: "住信SBI銀行", color: "#64748B" },
  { id: "coincheck", label: "Coincheck",  color: "#22C55E" },
  { id: "loan",      label: "住宅ローン", color: "#EF4444" },
];

// ── 集計区分 ──
const CATEGORIES = [
  { id: "cash_sbi",    label: "SBI買付余力（現金）", color: "#38BDF8" },
  { id: "tokutei",     label: "特定預り",       color: "#3B82F6" },
  { id: "nisa_growth", label: "NISA成長投資枠", color: "#8B5CF6" },
  { id: "nisa_old",    label: "旧NISA",         color: "#6366F1" },
  { id: "tsumitate",   label: "つみたてNISA",   color: "#EC4899" },
  { id: "us",          label: "SBI海外株",      color: "#10B981" },
  { id: "paypay",      label: "PayPay証券",     color: "#F59E0B" },
  { id: "crypto",      label: "暗号資産",       color: "#22C55E" },
  { id: "bank",        label: "住信SBI銀行",    color: "#64748B" },
  { id: "loan",        label: "住宅ローン残高", color: "#EF4444", isLiability: true },
];
const CAT_MAP = { "特定": "tokutei", "成長": "nisa_growth", "旧": "nisa_old", "積立": "tsumitate", "cash": "cash_sbi" };
const SCOPE_CAT = { sbi_us: "us", paypay: "paypay", bank: "bank", coincheck: "crypto", loan: "loan" };
const STORAGE_KEY = "portfolio_data_v3";
const RE_KEY = "realestate_v1"; // 不動産データは独立キーで保存（他の同期に影響されない）
// NISA年間投資枠の上限
const ANNUAL_GROWTH = 2400000, ANNUAL_TSUMITATE = 1200000;


// CSS変数でテーマ管理（スコープ問題なし）
const THEMES = {
  light: {
    "--bg":       "#F0F4F8",
    "--surface":  "#FFFFFF",
    "--surface2": "#F8FAFC",
    "--border":   "#94A3B8",
    "--text":     "#0F172A",
    "--muted":    "#374151",
    "--dim":      "#6B7280",
    "--accent":   "#2563EB",
    "--pos":      "#059669",
    "--neg":      "#DC2626",
    "--tab-bg":   "#E2E8F0",
    "--input-bg": "#F8FAFC",
    "--tip-bg":   "#1E293B",
    "--hero-grad":"linear-gradient(135deg,#1e3a8a 0%,#2563EB 100%)",
    "--bar-track":"#D1D5DB",
  },
  dark: {
    "--bg":       "#0A0E1A",
    "--surface":  "#141B2D",
    "--surface2": "#0F1626",
    "--border":   "#1E293B",
    "--text":     "#F1F5F9",
    "--muted":    "#94A3B8",
    "--dim":      "#475569",
    "--accent":   "#3B82F6",
    "--pos":      "#10B981",
    "--neg":      "#EF4444",
    "--tab-bg":   "#0F1626",
    "--input-bg": "#0F1626",
    "--tip-bg":   "#0F1626",
    "--hero-grad":"linear-gradient(135deg,#1a2744 0%,#0F1626 100%)",
    "--bar-track":"#1a2237",
  },
};

function applyTheme(t) {
  const vars = THEMES[t] || THEMES.dark;
  const root = document.documentElement;
  Object.entries(vars).forEach(([k, v]) => root.style.setProperty(k, v));
  root.setAttribute("data-theme", t);
}

const fmt = (v) => (v == null ? "―" : "¥" + Math.round(v).toLocaleString("ja-JP"));
const fmtPct = (v) => (v == null ? "―" : (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%");
const fmtSign = (v) => (v == null ? "―" : (v >= 0 ? "+¥" : "-¥") + Math.round(Math.abs(v)).toLocaleString("ja-JP"));

async function analyzeScreenshot(b64, mediaType, scopeId, scopeLabel) {
  const base = `Analyze this Japanese brokerage/bank screenshot (account: ${scopeLabel}).
Output ONLY a compact JSON array. No markdown, no commentary.
Calculation rules:
- Stocks: mv = 保有株数 × 現在値.
- Investment funds (投資信託): mv = 保有口数 × 基準価額 ÷ 10000.
- g = the 評価損益 shown (red/+ = gain, blue/- = loss).
- p = g ÷ (mv - g) × 100, 2 decimals.
- Include EVERY row across ALL sections. Keep names short.`;

  const schema = scopeId === "sbi_jp"
    ? `This screen may contain two sections: (1) a left panel with cash/balance info, and (2) a right panel with stock holdings.

SECTION 1 — Cash (left panel). If you see 「買付余力」or「現金残高等」or「保有資産評価」block, extract the cash balance:
- Look for 「現金残高等（合計）」or「買付余力(2営業日後)」— use whichever shows the total available cash.
- Output as: {"n":"買付余力","mv":金額,"g":0,"p":0,"c":"cash"}

SECTION 2 — Stock/fund holdings (right panel). Each row shows: [4-digit code] [銘柄名] in the left column of the table.
CRITICAL: Extract the 4-digit numeric code that appears BEFORE the stock name on each row (e.g. "2521 上場米国ヘッジあり" → cd="2521", n="上場米国ヘッジあり"). For investment trusts, use the fund code if shown (e.g. "2558", "2840"). If no numeric code is visible, set cd=null.

Add "c" to classify which section header the holding appears under:
- "特定" = 株式(現物/特定預り)
- "成長" = any NISA成長投資枠 section (株式 OR 投資信託)
- "旧"   = 旧NISA預り
- "積立" = つみたて投資枠

Format: [{"n":"銘柄名（コードなし）","cd":"4桁コード or null","mv":評価額,"g":損益,"p":損益率,"c":"特定|成長|旧|積立"}]

IMPORTANT: "n" must contain ONLY the name, NOT the code. "cd" must be the 4-digit numeric string.
Output ALL items (cash + holdings) in one flat JSON array.`
    : scopeId === "bank"
    ? `Bank balance screen. Output one object per balance:
Format: [{"n":"普通預金","mv":残高,"g":0,"p":0}]`
    : scopeId === "sbi_us"
    ? `This is an SBI Securities foreign stock holdings screen. Two possible formats:

FORMAT A - 口座サマリー（外貨建商品）: Each row shows [TICKER 日本語名] then quantity/取得単価/現在値/外貨建評価損益.
FORMAT B - ポートフォリオ画面: Each row shows 日本語名 with USD badge, then 円評価額(¥xxx) and USD現在値, 含み損益(+$xx USD / +¥xx円).

For FORMAT A:
- "cd" = ticker in CAPS at start of name line (e.g. "JD", "KO", "MU", "AMZN"). CRITICAL: always extract.
- "n" = Japanese name after ticker, copied EXACTLY as shown on screen (e.g. "JDドットコム ADR", "コカ・コーラ", "Direxion デイリーS&P500ブル3倍 ETF"). Do NOT shorten, abbreviate or paraphrase. Do NOT include ticker in n.
- "mv" = 保有数量 × 現在値 (local currency value).
- "g" = 外貨建評価損益 (the +/- number in local currency).
- "jpy" = null (no yen total shown).

For FORMAT B:
- "cd" = if ticker shown before Japanese name, extract it; otherwise null.
- "n" = Japanese name shown on screen, copied EXACTLY (e.g. "マイクロンテクノロジー", "テスラ", "グローバルX データセンター＆インフラ ETF"). Do NOT shorten or abbreviate.
- "mv" = USD現在値 shown below ¥ amount (e.g. "USD 864.01" → 864.01).
- "g" = USD損益 (e.g. "+$125 USD" → 125, "-$198 USD" → -198).
- "jpy" = ¥円評価額 shown (e.g. "¥138,518" → 138518). CRITICAL: extract this.
- "p" = 損益率% shown (e.g. "+16.97%" → 16.97).

Common fields:
- "cur" = "USD" (default) unless screen shows HKD/EUR etc.
- "p" = gain/loss percentage shown, or calculate from g and mv.

Format: [{"n":"日本語名","cd":"TICKERornull","cur":"USD","mv":現地単価or評価額,"g":現地損益,"p":損益率,"jpy":円評価額ornull}]
Output flat JSON array only, no markdown.`
    : scopeId === "coincheck"
    ? `This is a Coincheck cryptocurrency holdings screen (Japanese, values in JPY).
For each coin output its symbol, JPY valuation, and quantity held.
- "n" = coin symbol/name (BTC, ETH, XRP, etc.)
- "mv" = the JPY evaluation amount (円評価額) shown on screen.
- "q" = quantity held (保有量) if shown, else null.
- 損益 is usually NOT shown, so set g=null, p=null.
Format: [{"n":"BTC","mv":円評価額,"q":保有量ornull,"g":null,"p":null}]`
    : scopeId === "loan"
    ? `This is a Japanese bank internet banking screen showing housing loan balances (住宅ローン残高照会).
Extract EVERY loan row visible. For each:
- "n" = ローン名称 (e.g. 住宅ローン). If multiple loans of the same type, append a number (住宅ローン1, 住宅ローン2).
- "mv" = 現在残高 (current outstanding balance) as a positive integer in JPY.
- g = 0, p = 0 (loans have no gain/loss)
Format: [{"n":"住宅ローン","mv":残高,"g":0,"p":0}]`
    : `Format: [{"n":"銘柄名","mv":評価額,"g":損益,"p":損益率}]`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": window._portfolioApiKey || localStorage.getItem("anthropic_api_key") || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: base + "\n" + schema },
        ],
      }],
    }),
  });

  if (!response.ok) {
    let detail = "";
    try { detail = await response.text(); } catch {}
    throw new Error(`APIエラー ${response.status} ${detail.slice(0, 120)}`);
  }

  const data = await response.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");

  // 堅牢パーサ: フラットな {...} を全部拾い、壊れた末尾だけ無視
  const matches = text.match(/\{[^{}]*\}/g) || [];
  const holdings = [];
  for (const m of matches) {
    try {
      const o = JSON.parse(m);
      if (o.n != null && o.mv != null) {
        holdings.push({
          name: String(o.n),
          code: o.cd ? String(o.cd) : null,
          market_value: Number(o.mv),
          gain_loss: o.g != null ? Number(o.g) : null,
          gain_loss_pct: o.p != null ? Number(o.p) : null,
          cat: o.c != null ? (CAT_MAP[o.c] || "tokutei") : null,
          currency: o.cur ? String(o.cur).toUpperCase() : null,
          jpy_shown: o.jpy != null ? Number(o.jpy) : null,
          qty: o.q != null ? Number(o.q) : null,
        });
      }
    } catch { /* 断片はスキップ */ }
  }
  if (!holdings.length) throw new Error("解析結果を読み取れませんでした");
  return { holdings };
}

// Claude経由（web検索）で為替レートを取得。api.anthropic.comは必ず通信できる。
async function fetchRatesViaClaude(currencies) {
  const uniq = [...new Set(currencies.filter((c) => c && c !== "JPY"))];
  if (!uniq.length) return {};
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": window._portfolioApiKey || localStorage.getItem("anthropic_api_key") || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 400,
        messages: [{
          role: "user",
          content: `Look up today's foreign exchange rates to Japanese Yen (JPY) for these currencies: ${uniq.join(", ")}. Reply with ONLY a JSON object mapping each currency code to how many JPY one unit equals, e.g. {"USD":152.34}. No other text.`,
        }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });
    if (!resp.ok) return {};
    const data = await resp.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[^{}]*\}/);
    if (m) {
      const o = JSON.parse(m[0]);
      const out = {};
      for (const k in o) { const v = Number(o[k]); if (v > 0) out[k.toUpperCase()] = v; }
      return out;
    }
  } catch {}
  return {};
}

// 為替レート取得: Claude(web検索)を優先し、足りない分はfrankfurterで補う。
async function fetchRates(currencies) {
  const uniq = [...new Set(currencies.filter((c) => c && c !== "JPY"))];
  if (!uniq.length) return {};
  let rates = await fetchRatesViaClaude(uniq);
  const missing = uniq.filter((c) => !rates[c]);
  if (missing.length) {
    await Promise.all(missing.map(async (cur) => {
      try {
        const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=${cur}&symbols=JPY`);
        if (r.ok) {
          const d = await r.json();
          if (d.rates && d.rates.JPY) rates[cur] = d.rates.JPY;
        }
      } catch {}
    }));
  }
  return rates;
}

// CSVをShift-JIS優先で読む（SBIのCSVはShift-JISが多い。文字化けが多ければUTF-8に切替）
async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  let sjis = "";
  try { sjis = new TextDecoder("shift-jis").decode(buf); } catch {}
  const bad = (sjis.match(/\uFFFD/g) || []).length;
  if (!sjis || bad > 5) {
    try { return new TextDecoder("utf-8").decode(buf); } catch { return sjis; }
  }
  return sjis;
}

// 取引履歴からNISAの買付/売却＋米国株の取得情報を抽出（CSVテキスト or 画像）
async function analyzeTransactions(payload) {
  const instruction = `This is a Japanese securities transaction history (取引履歴) from SBI証券.
Output ONLY a compact JSON array, no markdown, no commentary. Three kinds of rows:

(A) NISA transactions (any NISA account):
{"t":"nisa","d":"YYYY-MM-DD","f":"成長|積立","a":受渡金額の整数(JPY),"s":0or1}

(B) US/foreign stock buy transactions (米国株式・外国株式の買付):
{"t":"us","d":"YYYY-MM-DD","n":"銘柄名orティッカー","jpy":受渡金額の整数(円),"usd":約定代金(ドル),"s":0or1}

(C) SELL transactions that show a realized profit/loss (実現損益・譲渡損益・実現損益額):
{"t":"sell","d":"YYYY-MM-DD","n":"銘柄名","pl":実現損益の整数(円),"tax":"特定|一般|NISA成長|NISA積立|旧NISA"}

Rules:
- d = 約定日 (受渡日 if 約定日 missing), convert to YYYY-MM-DD.
- For (A): f = 成長 or 積立 (from 預り区分). a = JPY settlement amount. s=1 if sell.
- For (B): foreign-currency stock trades. jpy = yen 受渡金額. usd = USD 約定代金. s=1 if sell.
- For (C): ONLY rows that are sells AND have a realized gain/loss value (実現損益/譲渡損益). pl = that yen amount (loss = negative). tax = the 預り区分/口座区分 (特定/一般/NISA成長投資枠→"NISA成長"/NISAつみたて→"NISA積立"/旧NISA). A sell row can be emitted as BOTH (A or B) and (C).
- IGNORE 配当金/分配金 and 入出金 rows.
- Include every relevant row.`;

  let content;
  if (payload.kind === "image") {
    content = [
      { type: "image", source: { type: "base64", media_type: payload.mediaType, data: payload.data } },
      { type: "text", text: instruction },
    ];
  } else {
    const text = payload.text.slice(0, 60000); // 念のため上限
    content = [{ type: "text", text: instruction + "\n\nCSV:\n" + text }];
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": window._portfolioApiKey || localStorage.getItem("anthropic_api_key") || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, messages: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    let d = ""; try { d = await response.text(); } catch {}
    throw new Error(`APIエラー ${response.status} ${d.slice(0, 120)}`);
  }
  const data = await response.json();
  const out = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const matches = out.match(/\{[^{}]*\}/g) || [];
  const txs = [], usTxs = [], sells = [];
  for (const m of matches) {
    try {
      const o = JSON.parse(m);
      if (o.t === "sell" && o.d && o.pl != null) {
        sells.push({ date: String(o.d), name: o.n ? String(o.n) : "―", pl: Number(o.pl), tax: o.tax ? String(o.tax) : "特定" });
      } else if (o.t === "us" && o.d && o.n) {
        usTxs.push({ date: String(o.d), name: String(o.n), jpy: o.jpy != null ? Number(o.jpy) : null, usd: o.usd != null ? Number(o.usd) : null, sell: o.s === 1 });
      } else if (o.d && o.a != null && (o.f === "成長" || o.f === "積立")) {
        txs.push({ date: String(o.d), frame: o.f === "成長" ? "growth" : "tsumitate", amount: Number(o.a), sell: o.s === 1 });
      }
    } catch {}
  }
  if (!txs.length && !usTxs.length && !sells.length) throw new Error("取引が見つかりませんでした");
  return { txs, usTxs, sells };
}

// Coincheckの購入履歴から、通貨別の買付（日付・通貨・数量・円金額）を抽出
async function analyzeCryptoBuys(payload) {
  const instruction = `This is a Coincheck cryptocurrency purchase history (販売所の購入履歴, Japanese, JPY).
Output ONLY a compact JSON array, no markdown, no commentary.
For each BUY row: {"d":"YYYY-MM-DD","n":"通貨シンボル(BTC等)","jpy":購入金額の整数(円),"q":購入数量ornull}
Rules:
- d = the trade date, convert to YYYY-MM-DD.
- n = coin symbol (BTC, ETH, XRP, etc.).
- jpy = the JPY amount paid for that purchase (整数).
- q = quantity bought if shown, else null.
- These are all purchases (買い). Include every row.`;

  let content;
  if (payload.kind === "image") {
    content = [
      { type: "image", source: { type: "base64", media_type: payload.mediaType, data: payload.data } },
      { type: "text", text: instruction },
    ];
  } else {
    content = [{ type: "text", text: instruction + "\n\nCSV:\n" + payload.text.slice(0, 60000) }];
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": window._portfolioApiKey || localStorage.getItem("anthropic_api_key") || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, messages: [{ role: "user", content }] }),
  });
  if (!response.ok) {
    let d = ""; try { d = await response.text(); } catch {}
    throw new Error(`APIエラー ${response.status} ${d.slice(0, 120)}`);
  }
  const data = await response.json();
  const out = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const matches = out.match(/\{[^{}]*\}/g) || [];
  const buys = [];
  for (const m of matches) {
    try {
      const o = JSON.parse(m);
      if (o.d && o.n && o.jpy != null) {
        buys.push({ date: String(o.d), name: String(o.n).toUpperCase(), jpy: Number(o.jpy), qty: o.q != null ? Number(o.q) : null });
      }
    } catch {}
  }
  if (!buys.length) throw new Error("購入履歴が見つかりませんでした");
  return buys;
}

// グルーピング用カラーパレット
const PALETTE = ["#3B82F6", "#10B981", "#8B5CF6", "#F59E0B", "#EC4899", "#06B6D4", "#EF4444", "#84CC16", "#6366F1", "#F97316", "#14B8A6", "#A855F7", "#0EA5E9", "#F43F5E"];

const GIST_FILENAME = "portfolio-data.json";
// Secret Gistを新規作成してIDを返す
async function gistCreate(token, payload) {
  const resp = await fetch("https://api.github.com/gists", {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({
      description: "Zenith data (private)",
      public: false, // Secret Gist
      files: { [GIST_FILENAME]: { content: JSON.stringify(payload) } },
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Gist作成失敗 ${resp.status}: ${t.slice(0, 100)}`);
  }
  const d = await resp.json();
  return d.id;
}
// 既存Gistへ上書き保存
async function gistSave(token, gistId, payload) {
  const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: "PATCH",
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json", "Content-Type": "application/json" },
    body: JSON.stringify({ files: { [GIST_FILENAME]: { content: JSON.stringify(payload) } } }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Gist保存失敗 ${resp.status}: ${t.slice(0, 100)}`);
  }
  return true;
}
// Gistから読み込み
async function gistLoad(token, gistId) {
  const resp = await fetch(`https://api.github.com/gists/${gistId}`, {
    headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json" },
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Gist読込失敗 ${resp.status}: ${t.slice(0, 100)}`);
  }
  const d = await resp.json();
  const file = d.files && d.files[GIST_FILENAME];
  if (!file || !file.content) throw new Error("Gistにデータが見つかりません");
  return JSON.parse(file.content);
}

// リターン(%)を緑〜赤のヒートマップ色に変換
function retColor(r) {
  if (r == null) return "var(--surface2)";
  const t = Math.max(-1, Math.min(1, r / 40));
  const a = Math.abs(t);
  const hue = t >= 0 ? 152 : 6;
  const light = 40 - a * 17;
  const sat = 42 + a * 34;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

// squarifiedツリーマップ レイアウト計算
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const scale = (w * h) / total;
  let rest = items.map((i) => ({ ...i, area: i.value * scale })).filter((i) => i.area > 0);
  const out = [];
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (row, len) => {
    const sum = row.reduce((s, i) => s + i.area, 0);
    const mx = Math.max(...row.map((i) => i.area));
    const mn = Math.min(...row.map((i) => i.area));
    const s2 = sum * sum;
    return Math.max((len * len * mx) / s2, s2 / (len * len * mn));
  };
  const layoutRow = (row, horizontal) => {
    const sum = row.reduce((s, i) => s + i.area, 0);
    let off = 0;
    if (horizontal) {
      const thick = sum / rw;
      row.forEach((it) => { const seg = it.area / thick; out.push({ ...it, x: rx + off, y: ry, w: seg, h: thick }); off += seg; });
      ry += thick; rh -= thick;
    } else {
      const thick = sum / rh;
      row.forEach((it) => { const seg = it.area / thick; out.push({ ...it, x: rx, y: ry + off, w: thick, h: seg }); off += seg; });
      rx += thick; rw -= thick;
    }
  };
  while (rest.length) {
    const horizontal = rw >= rh;
    const len = horizontal ? rw : rh;
    let cur = [];
    while (rest.length) {
      const next = [...cur, rest[0]];
      if (cur.length === 0 || worst(next, len) <= worst(cur, len)) cur.push(rest.shift());
      else break;
    }
    layoutRow(cur, horizontal);
  }
  return out;
}

// ヒートマップ（面積=規模, 色=リターン）
function Heatmap({ items, fmt }) {
  const W = 1000, H = 560;
  const data = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  if (!data.length) return null;
  const cells = squarify(data, 0, 0, W, H);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", borderRadius: 12 }}>
      {cells.map((c, i) => {
        const small = c.w < 95 || c.h < 55;
        const tiny = c.w < 55 || c.h < 34;
        return (
          <g key={i}>
            <rect x={c.x + 2} y={c.y + 2} width={Math.max(0, c.w - 4)} height={Math.max(0, c.h - 4)} rx={8}
              fill={retColor(c.ret)} stroke="var(--bg)" strokeWidth={2} />
            {!tiny && (
              <text x={c.x + 14} y={c.y + 30} fill="#fff" fontSize={small ? 20 : 26} fontWeight="700" style={{ pointerEvents: "none" }}>
                {c.name.length > (small ? 6 : 12) ? c.name.slice(0, small ? 6 : 12) : c.name}
              </text>
            )}
            {!small && c.ret != null && (
              <text x={c.x + 14} y={c.y + 60} fill="rgba(255,255,255,0.96)" fontSize={28} fontWeight="800" style={{ pointerEvents: "none" }}>
                {c.ret >= 0 ? "+" : ""}{c.ret.toFixed(1)}%
              </text>
            )}
            {!small && (
              <text x={c.x + 14} y={c.y + c.h - 16} fill="rgba(255,255,255,0.78)" fontSize={19} style={{ pointerEvents: "none" }}>
                {fmt(c.value)}
              </text>
            )}
            {small && !tiny && c.ret != null && (
              <text x={c.x + 14} y={c.y + 52} fill="rgba(255,255,255,0.96)" fontSize={19} fontWeight="700" style={{ pointerEvents: "none" }}>
                {c.ret >= 0 ? "+" : ""}{c.ret.toFixed(0)}%
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// パフォーマンス散布図（x=リターン%, 円の大きさ=損益額, 色=損益）
function PerfScatter({ holdings, fmt, fmtSign }) {
  const W = 1000, H = 460, padL = 96, padR = 36, padT = 28, padB = 50;
  const pts = holdings.filter((h) => h.ret != null && h.gain_loss != null && h.market_value != null);
  if (!pts.length) return null;
  // x: リターン%
  const rets = pts.map((p) => p.ret);
  let minR = Math.min(0, ...rets), maxR = Math.max(0, ...rets);
  const spanR = Math.max(10, maxR - minR);
  minR -= spanR * 0.1; maxR += spanR * 0.1;
  // y: 損益額
  const gls = pts.map((p) => p.gain_loss);
  let minG = Math.min(0, ...gls), maxG = Math.max(0, ...gls);
  const spanG = Math.max(1, maxG - minG);
  minG -= spanG * 0.12; maxG += spanG * 0.12;
  // 円: 評価額
  const maxVal = Math.max(1, ...pts.map((p) => p.market_value));
  const xOf = (r) => padL + ((r - minR) / (maxR - minR)) * (W - padL - padR);
  const yOf = (g) => padT + (1 - (g - minG) / (maxG - minG)) * (H - padT - padB);
  const rOf = (v) => 9 + Math.sqrt(v / maxVal) * 42;
  const zeroX = xOf(0), zeroY = yOf(0);
  const placed = [...pts].sort((a, b) => b.market_value - a.market_value)
    .map((p) => ({ ...p, cx: xOf(p.ret), cy: yOf(p.gain_loss), r: rOf(p.market_value) }));
  const yTicks = [minG, (minG + maxG) / 2, maxG];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {/* 象限の薄い塗り分け（右上=高リターンで利益 / 左下=低リターンで損失） */}
      <rect x={zeroX} y={padT} width={Math.max(0, W - padR - zeroX)} height={Math.max(0, zeroY - padT)} fill="rgba(16,185,129,0.05)" />
      <rect x={padL} y={zeroY} width={Math.max(0, zeroX - padL)} height={Math.max(0, H - padB - zeroY)} fill="rgba(248,113,113,0.05)" />
      {/* 0軸 */}
      <line x1={zeroX} y1={padT} x2={zeroX} y2={H - padB} stroke="var(--dim)" strokeWidth={1.5} strokeDasharray="6 5" />
      <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="var(--dim)" strokeWidth={1.5} strokeDasharray="6 5" />
      {/* 軸ラベル */}
      <text x={(padL + W - padR) / 2} y={H - 12} fill="var(--dim)" fontSize={17} textAnchor="middle">リターン →</text>
      <text x={zeroX} y={H - padB + 24} fill="var(--dim)" fontSize={15} textAnchor="middle">0%</text>
      <text x={W - padR} y={H - padB + 24} fill="var(--dim)" fontSize={15} textAnchor="end">+{maxR.toFixed(0)}%</text>
      <text x={padL} y={H - padB + 24} fill="var(--dim)" fontSize={15} textAnchor="start">{minR.toFixed(0)}%</text>
      {yTicks.map((g, i) => (
        <text key={i} x={padL - 10} y={yOf(g) + 5} fill="var(--dim)" fontSize={14} textAnchor="end">{fmtSign(g)}</text>
      ))}
      <text x={22} y={(padT + H - padB) / 2} fill="var(--dim)" fontSize={15} textAnchor="middle" transform={`rotate(-90 22 ${(padT + H - padB) / 2})`}>損益額 ↑</text>
      {placed.map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.gain_loss >= 0 ? "rgba(16,185,129,0.26)" : "rgba(248,113,113,0.24)"}
            stroke={p.gain_loss >= 0 ? "#10B981" : "#F87171"} strokeWidth={2} />
          {p.r > 22 && (
            <text x={p.cx} y={p.cy + 5} fill="var(--text)" fontSize={15} fontWeight="700" textAnchor="middle" style={{ pointerEvents: "none" }}>
              {p.name.length > 6 ? p.name.slice(0, 6) : p.name}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

// 保有銘柄をAIで分類（資産クラス・地域・セクター）
async function classifyHoldings(holdings) {
  const names = [...new Set(holdings.map((h) => h.name))];
  const prompt = `Classify each Japanese/US security below. Return ONLY a JSON array, no markdown, no commentary.
For each name output: {"n":"<exact name>","ac":"<asset class>","rg":"<region>","sc":"<sector>"}
- ac (資産クラス): one of 個別株, ETF, 投資信託, REIT, 債券, 現金, コモディティ
- rg (地域): one of 日本, 米国, 先進国, 新興国, 全世界, その他
- sc (セクター): short Japanese sector for individual stocks (例: 半導体, 外食, 通信, 金融, 不動産, 自動車, 小売, ヘルスケア, 素材, エネルギー, 資本財, IT, レジャー). For funds/ETF/cash use "分散".
Names: ${JSON.stringify(names)}`;

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": window._portfolioApiKey || localStorage.getItem("anthropic_api_key") || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 4000, messages: [{ role: "user", content: prompt }] }),
  });
  if (!resp.ok) throw new Error(`分類APIエラー ${resp.status}`);
  const data = await resp.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const matches = text.match(/\{[^{}]*\}/g) || [];
  const map = {};
  for (const m of matches) {
    try {
      const o = JSON.parse(m);
      if (o.n) map[String(o.n)] = { asset_class: o.ac || null, region: o.rg || null, sector: o.sc || null };
    } catch {}
  }
  if (!Object.keys(map).length) throw new Error("分類結果を読み取れませんでした");
  return map;
}





// APIキー設定画面
function ApiKeySetup({ onSave }) {
  const [key, setKey] = React.useState("");
  const [err, setErr] = React.useState("");
  const [testing, setTesting] = React.useState(false);

  const test = async () => {
    const k = key.trim();
    if (!k.startsWith("sk-ant-")) { setErr("Anthropic APIキーは sk-ant- で始まります"); return; }
    setTesting(true); setErr("");
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": k, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error?.message || `エラー ${r.status}`); }
      localStorage.setItem("anthropic_api_key", k);
      window._portfolioApiKey = k;
      onSave(k);
    } catch (e) {
      setErr("接続失敗: " + e.message);
    } finally { setTesting(false); }
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 460, background: "var(--surface)", border: "1px solid #1E293B", borderRadius: 16, padding: 32 }}>
        <div style={{ fontSize: 11, color: "#3B82F6", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>Zenith</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>APIキーの設定</div>
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, marginBottom: 24 }}>
          スクショ解析・株式探索・為替取得にAnthropicのAPIキーが必要です。キーはこのブラウザのみに保存され、外部には送信されません。
        </div>
        <div style={{ fontSize: 12, color: "var(--dim)", marginBottom: 6 }}>Anthropic APIキー</div>
        <input type="password" placeholder="sk-ant-api03-..." value={key} onChange={e => setKey(e.target.value)}
          onKeyDown={e => e.key === "Enter" && test()}
          style={{ width: "100%", padding: "10px 12px", background: "var(--surface2)", border: "1px solid #1E293B", borderRadius: 8, color: "var(--text)", fontSize: 13, fontFamily: "monospace", boxSizing: "border-box", marginBottom: 8 }} />
        {err && <div style={{ fontSize: 12, color: "#F87171", marginBottom: 8 }}>⚠ {err}</div>}
        <button onClick={test} disabled={testing || !key.trim()} style={{
          width: "100%", padding: "11px", background: testing ? "var(--surface2)" : "#3B82F6", border: "none", borderRadius: 9,
          color: "#fff", fontSize: 14, fontWeight: 700, cursor: testing ? "default" : "pointer", fontFamily: "inherit", marginBottom: 20,
        }}>{testing ? "⟳ 接続確認中..." : "接続してアプリを開く"}</button>
        <div style={{ fontSize: 11, color: "var(--dim)", lineHeight: 1.7, borderTop: "1px solid #1E293B", paddingTop: 16 }}>
          <strong style={{ color: "var(--dim)" }}>APIキーの取得方法</strong><br />
          1. <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: "#3B82F6" }}>console.anthropic.com</a> にGoogleアカウントでログイン<br />
          2. Settings → API Keys → 「Create Key」<br />
          3. 生成されたキー（sk-ant-...）をコピーして上に貼り付け<br /><br />
          <strong style={{ color: "var(--dim)" }}>費用について</strong>: スクショ取込・為替・探索を合わせて月数十〜数百円程度です。
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = React.useState(() => {
    const k = localStorage.getItem("anthropic_api_key") || "";
    if (k) window._portfolioApiKey = k;
    return k;
  });
  const [theme, setTheme] = React.useState(() => {
    const t = localStorage.getItem("zenith_theme") || "light";
    applyTheme(t);
    return t;
  });
  const isDark = theme === "dark";
  const toggleTheme = () => {
    const t = theme === "dark" ? "light" : "dark";
    applyTheme(t);
    setTheme(t);
    localStorage.setItem("zenith_theme", t);
  };
  if (!apiKey) return <ApiKeySetup onSave={setApiKey} />;
  const [tab, setTab] = useState("dashboard");
  const [holdingsRaw, setHoldings] = useState([]);
  const [history, setHistory] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [usCost, setUsCost] = useState([]); // 米国株の取得情報（円簿価算出用）
  const [realized, setRealized] = useState([]); // 実現損益（売却）
  const [cryptoBuys, setCryptoBuys] = useState([]); // Coincheck購入履歴（取得額算出用）
  const [realestate, setRealestate] = useState({ land: "", buildCost: "", builtYear: "", note: "" }); // 不動産
  // 株式探索（結果はデバイスローカルに保存）
  const STOCK_QUERY_DEFAULT = `テーマ：フィジカルAI（AI×物理世界）関連の日本の成長期待株を発掘する

対象：フィジカルAI（ロボット・FA・センサー・画像認識・エッジAI・IoT・制御機器・半導体製造装置・検査装置・物流自動化・建設DX・介護DX等）の普及により実需が拡大し、売上・利益成長に直結する日本の上場企業

選定基準：
・AIテーマ株というだけでなく、一次情報（決算短信・IR・中計）で業績成長の道筋が見える企業を優先
・現時点で市場の評価が十分に追いついていない銘柄（過度に期待が先行している人気株は除外）
・PER15倍以下を高評価、営業利益20%成長時はPER18倍まで許容
・時価総額の大小は問わない（大中小型株すべて対象）`;
  const [stockQuery, setStockQuery] = useState(STOCK_QUERY_DEFAULT);
  const [stockResults, setStockResults] = useState([]);
  const [stockStatus, setStockStatus] = useState("idle"); // idle/loading/done/error
  const [stockError, setStockError] = useState(null);
  const [stockUpdatedAt, setStockUpdatedAt] = useState(null);
  const [stockExpanded, setStockExpanded] = useState({});
  const [holdingSort, setHoldingSort] = useState("mv"); // mv / gl / pct
  const [status, setStatus] = useState({});
  const [errors, setErrors] = useState({});
  const [loaded, setLoaded] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState(null); // 貼り付け先の枠（sbi_jp/sbi_us/paypay/bank/tx）
  const [manualUsdJpy, setManualUsdJpy] = useState(""); // 為替自動取得が失敗したとき用の予備
  const manualRef = useRef("");
  useEffect(() => { manualRef.current = manualUsdJpy; }, [manualUsdJpy]);
  const [groupDim, setGroupDim] = useState("cat"); // 分析タブのグルーピング軸
  const [classifying, setClassifying] = useState(false);
  const [classifyErr, setClassifyErr] = useState(null);
  const [sectorBench, setSectorBench] = useState(null); // セクター指数比較の結果
  const [market, setMarket] = useState(null); // 主要指数・市場センチメント
  const [benchLoading, setBenchLoading] = useState(false);
  const [benchErr, setBenchErr] = useState(null);
  const [lastSync, setLastSync] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [backupText, setBackupText] = useState("");
  const [showBackup, setShowBackup] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  // GitHub Gist 同期設定（端末ごとにローカル保存）
  const [gistToken, setGistToken] = useState("");
  const [gistId, setGistId] = useState("");
  const [gistMsg, setGistMsg] = useState(null);
  const [gistBusy, setGistBusy] = useState(false);
  const gistRef = useRef({ token: "", id: "" });
  const tokenInputRef = useRef(null);
  const idInputRef = useRef(null);

  useEffect(() => {
    (async () => {
      let gToken = "", gId = "";
      try {
        {
          // Gist設定を読込
          try {
            const _gv = localStorage.getItem("gist_config");
            if (_gv) { const gc = JSON.parse(_gv); gToken = gc.token || ""; gId = gc.id || ""; setGistToken(gToken); setGistId(gId); gistRef.current = { token: gToken, id: gId }; }
          } catch {}
          // ローカル保存を読込（フォールバック表示用）
          const _rv = localStorage.getItem(STORAGE_KEY);
          if (_rv) {
            const d = JSON.parse(_rv);
            setHoldings(d.holdings || []);
            setHistory(d.history || []);
            setTransactions(d.transactions || []);
            setUsCost(d.usCost || []); setRealized(d.realized || []); setCryptoBuys(d.cryptoBuys || []); if(d.realestate) setRealestate(d.realestate);
            setLastSync(new Date());
          }
        }
      } catch {}
      // Gist設定があればクラウドから上書きロード（端末間同期の本命）
      if (gToken && gId) {
        try {
          const d = await gistLoad(gToken, gId);
          setHoldings(d.holdings || []);
          setHistory(d.history || []);
          setTransactions(d.transactions || []);
          setUsCost(d.usCost || []); setRealized(d.realized || []); setCryptoBuys(d.cryptoBuys || []); if(d.realestate) setRealestate(d.realestate);
          setLastSync(new Date());
        } catch (e) { setGistMsg({ ok: false, text: "Gist読込: " + (e.message || "失敗") }); }
      }
      setLoaded(true);
      // 不動産データは独立キーから読む（Gistや他の同期に影響されない）
      try {
        {
          const re = { value: localStorage.getItem(RE_KEY) };
          if (re && re.value) setRealestate(JSON.parse(re.value));
        }
      } catch {}
      // 株式探索結果は別キーでローカル保存
      try {
        {
          const _srv = localStorage.getItem("stock_results_v1");
          if (_srv) {
            const d = JSON.parse(_srv);
            if (d.results) setStockResults(d.results);
            if (d.query) setStockQuery(d.query);
            if (d.updatedAt) setStockUpdatedAt(new Date(d.updatedAt));
          }
        }
      } catch {}
    })();
  }, []);

  // 最新を取り込む（Gist設定があればクラウド優先、なければローカル）
  const reloadFromStorage = useCallback(async (showSpin) => {
    if (showSpin) setSyncing(true);
    const { token, id } = gistRef.current;
    try {
      if (token && id) {
        const d = await gistLoad(token, id);
        setHoldings(d.holdings || []);
        setHistory(d.history || []);
        setTransactions(d.transactions || []);
        setUsCost(d.usCost || []); setRealized(d.realized || []); setCryptoBuys(d.cryptoBuys || []); if(d.realestate) setRealestate(d.realestate);
        setLastSync(new Date());
      } else {
        const r = { value: localStorage.getItem(STORAGE_KEY) };
        if (r && r.value) {
          const d = JSON.parse(r.value);
          setHoldings(d.holdings || []);
          setHistory(d.history || []);
          setTransactions(d.transactions || []);
          setUsCost(d.usCost || []); setRealized(d.realized || []); setCryptoBuys(d.cryptoBuys || []); if(d.realestate) setRealestate(d.realestate);
          setLastSync(new Date());
        }
      }
    } catch (e) { setGistMsg({ ok: false, text: "同期: " + (e.message || "失敗") }); }
    if (showSpin) setTimeout(() => setSyncing(false), 300);
  }, []);

  // 画面復帰（タブ表示・フォーカス）時に自動で最新を取り込む
  useEffect(() => {
    if (!loaded) return;
    const onVisible = () => { if (document.visibilityState === "visible") reloadFromStorage(false); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [loaded, reloadFromStorage]);

  useEffect(() => {
    if (!loaded) return;
    const payload = { holdings: holdingsRaw, history, transactions, usCost, realized, cryptoBuys };
    (async () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {}
    })();
    // Gistへはデバウンスして自動保存（連続変更時の多重送信を防ぐ）
    const { token, id } = gistRef.current;
    if (token && id) {
      const t = setTimeout(async () => {
        try {
          await gistSave(token, id, payload);
          setLastSync(new Date());
          setGistMsg({ ok: true, text: "クラウド保存済み" });
        } catch (e) { setGistMsg({ ok: false, text: "Gist保存: " + (e.message || "失敗") }); }
      }, 1500);
      return () => clearTimeout(t);
    }
  }, [holdingsRaw, history, transactions, usCost, realized, cryptoBuys, loaded]);

  // 不動産データは独立して保存（他の同期処理に左右されない）
  useEffect(() => {
    if (!loaded) return;
    (async () => {
      try {
        localStorage.setItem(RE_KEY, JSON.stringify(realestate));
      } catch {}
    })();
  }, [realestate, loaded]);

  const processFile = useCallback(async (file, scopeId, scopeLabel) => {
    if (!file || !file.type.startsWith("image/")) return;
    setStatus((s) => ({ ...s, [scopeId]: "loading" }));
    setErrors((e) => { const n = { ...e }; delete n[scopeId]; return n; });
    try {
      const b64 = await new Promise((res, rej) => {
        const reader = new FileReader();
        reader.onload = (e) => res(e.target.result.split(",")[1]);
        reader.onerror = () => rej(new Error("ファイル読み込み失敗"));
        reader.readAsDataURL(file);
      });
      const mediaType = file.type === "image/png" ? "image/png"
        : file.type === "image/webp" ? "image/webp"
        : file.type === "image/gif" ? "image/gif" : "image/jpeg";

      const result = await analyzeScreenshot(b64, mediaType, scopeId, scopeLabel);
      const now = new Date().toISOString().slice(0, 10);

      let newH;
      if (scopeId === "sbi_us") {
        // 海外株: 通貨を判別し円換算。集計用のmarket_value/gain_lossは円に統一。
        const currencies = result.holdings.map((h) => h.currency).filter(Boolean);
        const rates = await fetchRates(currencies);
        const manual = parseFloat(manualRef.current);
        const manualValid = !isNaN(manual) && manual > 0;
        newH = result.holdings.map((h) => {
          const cur = h.currency || "USD";
          // 円換算レート: 手動USD/JPY（USDのみ）> 自動取得 > なし
          const rate = (manualValid && cur === "USD") ? manual : (cur === "JPY" ? 1 : rates[cur]);
          // 円換算: 評価額は画面の円表示があれば優先、無ければ為替換算
          const mvJpy = h.jpy_shown != null ? h.jpy_shown : (rate ? h.market_value * rate : null);
          // 含み損益は現地通貨建てなので為替換算
          const glJpy = (h.gain_loss != null && rate) ? h.gain_loss * rate : null;
          return {
            name: h.name,
            code: h.code || null,
            market_value: mvJpy != null ? Math.round(mvJpy) : null,
            gain_loss: glJpy != null ? Math.round(glJpy) : null,
            gain_loss_pct: h.gain_loss_pct,
            currency: cur,
            local_value: h.market_value,
            local_gain_loss: h.gain_loss,
            fx_rate: rate || null,
            src: scopeId,
            cat: "us",
            updated: now,
          };
        });
      } else {
        newH = result.holdings.map((h) => ({
          name: h.name,
          market_value: h.market_value,
          gain_loss: h.gain_loss,
          gain_loss_pct: h.gain_loss_pct,
          qty: h.qty != null ? h.qty : null,
          src: scopeId,
          cat: scopeId === "sbi_jp" ? (h.cat || "tokutei") : SCOPE_CAT[scopeId],
          updated: now,
        }));
      }

      setHoldings((prev) => {
        const merged = [...prev.filter((h) => h.src !== scopeId), ...newH];
        const tv = merged.reduce((s, h) => s + (h.market_value || 0), 0);
        const tg = merged.reduce((s, h) => s + (h.gain_loss || 0), 0);
        setHistory((hist) => [...hist.filter((p) => p.date !== now), { date: now, total: tv, gain_loss: tg }].slice(-90));
        return merged;
      });
      setStatus((s) => ({ ...s, [scopeId]: "done" }));
    } catch (err) {
      setStatus((s) => ({ ...s, [scopeId]: "error" }));
      setErrors((e) => ({ ...e, [scopeId]: err.message || "解析に失敗しました" }));
    }
  }, []);

  const processTxFile = useCallback(async (file) => {
    if (!file) return;
    setStatus((s) => ({ ...s, tx: "loading" }));
    setErrors((e) => { const n = { ...e }; delete n.tx; return n; });
    try {
      const isImage = file.type.startsWith("image/");
      let result;
      if (isImage) {
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = (e) => res(e.target.result.split(",")[1]);
          r.onerror = () => rej(new Error("読み込み失敗"));
          r.readAsDataURL(file);
        });
        const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";
        result = await analyzeTransactions({ kind: "image", data: b64, mediaType });
      } else {
        const text = await readTextSmart(file);
        result = await analyzeTransactions({ kind: "text", text });
      }
      const { txs, usTxs, sells } = result;
      // NISA取引: 日付+枠+金額で重複排除しつつマージ
      setTransactions((prev) => {
        const key = (t) => `${t.date}_${t.frame}_${t.amount}_${t.sell ? 1 : 0}`;
        const seen = new Set(prev.map(key));
        const add = txs.filter((t) => !seen.has(key(t)));
        return [...prev, ...add].sort((a, b) => a.date.localeCompare(b.date));
      });
      // 米国株の取得情報: 日付+銘柄+円額で重複排除しつつマージ
      setUsCost((prev) => {
        const key = (t) => `${t.date}_${t.name}_${t.jpy}_${t.sell ? 1 : 0}`;
        const seen = new Set(prev.map(key));
        const add = usTxs.filter((t) => !seen.has(key(t)));
        return [...prev, ...add].sort((a, b) => a.date.localeCompare(b.date));
      });
      // 実現損益: 日付+銘柄+損益額で重複排除しつつマージ
      setRealized((prev) => {
        const key = (t) => `${t.date}_${t.name}_${t.pl}_${t.tax}`;
        const seen = new Set(prev.map(key));
        const add = sells.filter((t) => !seen.has(key(t)));
        return [...prev, ...add].sort((a, b) => b.date.localeCompare(a.date));
      });
      setStatus((s) => ({ ...s, tx: "done" }));
    } catch (err) {
      setStatus((s) => ({ ...s, tx: "error" }));
      setErrors((e) => ({ ...e, tx: err.message || "解析に失敗しました" }));
    }
  }, []);

  const processCryptoBuyFile = useCallback(async (file) => {
    if (!file) return;
    setStatus((s) => ({ ...s, cryptobuy: "loading" }));
    setErrors((e) => { const n = { ...e }; delete n.cryptobuy; return n; });
    try {
      const isImage = file.type.startsWith("image/");
      let buys;
      if (isImage) {
        const b64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = (e) => res(e.target.result.split(",")[1]);
          r.onerror = () => rej(new Error("読み込み失敗"));
          r.readAsDataURL(file);
        });
        const mediaType = file.type === "image/png" ? "image/png" : "image/jpeg";
        buys = await analyzeCryptoBuys({ kind: "image", data: b64, mediaType });
      } else {
        const text = await readTextSmart(file);
        buys = await analyzeCryptoBuys({ kind: "text", text });
      }
      // 複数枚を追記マージ。日付+通貨+円額+数量で重複排除
      setCryptoBuys((prev) => {
        const key = (t) => `${t.date}_${t.name}_${t.jpy}_${t.qty}`;
        const seen = new Set(prev.map(key));
        const add = buys.filter((t) => !seen.has(key(t)));
        return [...prev, ...add].sort((a, b) => a.date.localeCompare(b.date));
      });
      setStatus((s) => ({ ...s, cryptobuy: "done" }));
    } catch (err) {
      setStatus((s) => ({ ...s, cryptobuy: "error" }));
      setErrors((e) => ({ ...e, cryptobuy: err.message || "解析に失敗しました" }));
    }
  }, []);

  const reset = () => {
    if (!window.confirm("全データをリセットしますか？")) return;
    setHoldings([]); setHistory([]); setTransactions([]); setUsCost([]); setRealized([]); setCryptoBuys([]); setRealestate({ land:"", buildCost:"", builtYear:"", note:"" }); setStatus({}); setErrors({});
  };

  // Gist設定を保存（端末ローカル）
  const saveGistConfig = async (token, id) => {
    gistRef.current = { token, id };
      try { localStorage.setItem("gist_config", JSON.stringify({ token, id })); } catch {}
  };
  // 「接続」ボタン: 既存IDがあれば読込、無ければ新規Secret Gist作成
  const connectGist = async () => {
    // stateが空でも入力欄の実値を読む（モバイルの貼り付け/自動入力対策）
    const token = (gistToken || tokenInputRef.current?.value || "").trim();
    const id = (gistId || idInputRef.current?.value || "").trim();
    if (!token) { setGistMsg({ ok: false, text: "トークンを入力してください" }); return; }
    setGistBusy(true); setGistMsg(null);
    if (token !== gistToken) setGistToken(token);
    if (id !== gistId) setGistId(id);
    try {
      const payload = { holdings: holdingsRaw, history, transactions, usCost, realized, cryptoBuys };
      if (id) {
        const d = await gistLoad(token, id);
        await saveGistConfig(token, id);
        setHoldings(d.holdings || []); setHistory(d.history || []); setTransactions(d.transactions || []);
        setUsCost(d.usCost || []); setRealized(d.realized || []); setCryptoBuys(d.cryptoBuys || []); if(d.realestate) setRealestate(d.realestate);
        setLastSync(new Date());
        setGistMsg({ ok: true, text: "接続してデータを読み込みました" });
      } else {
        const newId = await gistCreate(token, payload);
        setGistId(newId);
        await saveGistConfig(token, newId);
        setGistMsg({ ok: true, text: `Secret Gistを作成しました（ID: ${newId.slice(0, 8)}…）。このIDをもう一方の端末に入れてください` });
      }
    } catch (e) {
      setGistMsg({ ok: false, text: e.message || "接続に失敗しました" });
    } finally {
      setGistBusy(false);
    }
  };
  const disconnectGist = async () => {
    gistRef.current = { token: "", id: "" };
    setGistToken(""); setGistId("");
    try { (localStorage.removeItem("gist_config"), { deleted: true }); } catch {}
    setGistMsg({ ok: true, text: "同期を解除しました" });
  };

  const runStockSearch = async () => {
    setStockStatus("loading"); setStockError(null);
    const prompt = `あなたは日本株の調査アナリストです。以下の条件で日本の上場企業を実際に調査し、成長期待ランキング上位10銘柄を選定してください。

【探索条件】
${stockQuery}

【調査方法】
web検索で以下の一次情報を中心に調査してください：
・直近の決算短信・決算説明資料
・有価証券報告書・中期経営計画
・適時開示・IR資料・ニュースリリース
ニュース記事・SNS・掲示板は参考程度にとどめてください。

【評価軸（各20点・合計100点）】
1. 成長性：直近決算の売上・利益成長、受注残、今後2〜3年の成長シナリオ
2. 割安性：PER・PBR・EV/EBITDA、営業利益率、ネットキャッシュ
3. フィジカルAI関連度：実需との接点の具体性・蓋然性
4. 競争優位性：ニッチトップ・技術障壁・顧客基盤・スイッチングコスト
5. リスク耐性：特定顧客依存・希薄化リスク・技術陳腐化・内部統制

【出力形式】
必ずJSONのみで出力してください。マークダウン不要。
[
  {
    "rank": 1,
    "name": "会社名",
    "code": "1234",
    "overview": "事業概要（100字以内）",
    "connection": "フィジカルAI需要との接点（150字以内）",
    "earnings": "直近決算のポイント（150字以内）",
    "scenario": "今後2〜3年の成長シナリオ（150字以内）",
    "valuation": "割安性の評価（PER・PBR等含む・100字以内）",
    "advantage": "競争優位性（100字以内）",
    "risks": "主なリスク（100字以内）",
    "comment": "投資妙味コメント（100字以内）",
    "total": 85,
    "growth": 17,
    "val": 15,
    "ai": 19,
    "comp": 18,
    "risk": 16
  }
]`;

    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": window._portfolioApiKey || localStorage.getItem("anthropic_api_key") || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      if (!resp.ok) throw new Error(`APIエラー ${resp.status}`);
      const data = await resp.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      // JSON配列を抽出（[ から ] まで）
      let results = null;
      const first = text.indexOf("["), last = text.lastIndexOf("]");
      if (first >= 0 && last > first) {
        try { results = JSON.parse(text.slice(first, last + 1)); } catch {}
      }
      // フォールバック: 個別オブジェクトを拾う
      if (!results) {
        const matches = text.match(/\{[^{}]*"name"[^{}]*\}/g) || [];
        results = [];
        for (const m of matches) { try { results.push(JSON.parse(m)); } catch {} }
      }
      if (!results || !results.length) throw new Error("結果を取得できませんでした。しばらく待ってから再試行してください。");
      const now = new Date();
      setStockResults(results);
      setStockUpdatedAt(now);
      setStockStatus("done");
      // ローカル保存
      try {
        localStorage.setItem("stock_results_v1", JSON.stringify({ results, query: stockQuery, updatedAt: now.toISOString() }));
      } catch {}
    } catch (e) {
      setStockStatus("error");
      setStockError(e.message || "探索に失敗しました");
    }
  };

  const exportBackup = () => {
    setBackupText(JSON.stringify({ holdings: holdingsRaw, history, transactions, usCost, realized, cryptoBuys, realestate }));
    setShowBackup(true);
    setImportMsg(null);
  };

  const importBackup = () => {
    try {
      const d = JSON.parse(backupText.trim());
      if (!d || !Array.isArray(d.holdings)) throw new Error("形式が不正です");
      setHoldings(d.holdings || []);
      setHistory(d.history || []);
      setTransactions(d.transactions || []);
      setUsCost(d.usCost || []); setRealized(d.realized || []); setCryptoBuys(d.cryptoBuys || []); if(d.realestate) setRealestate(d.realestate);
      setImportMsg({ ok: true, text: `読み込み成功（${(d.holdings || []).length}銘柄）` });
    } catch (e) {
      setImportMsg({ ok: false, text: "読み込み失敗：" + (e.message || "不正なデータ") });
    }
  };

  const runClassify = useCallback(async () => {
    if (!holdingsRaw.length) return;
    setClassifying(true); setClassifyErr(null);
    try {
      const map = await classifyHoldings(holdingsRaw);
      setHoldings((prev) => prev.map((h) => map[h.name]
        ? { ...h, asset_class: map[h.name].asset_class, region: map[h.name].region, sector: map[h.name].sector }
        : h));
    } catch (e) {
      setClassifyErr(e.message || "分類に失敗しました");
    } finally {
      setClassifying(false);
    }
  }, [holdingsRaw]);

  // コードが未設定の銘柄にAIでコードを補完

  // セクター指数の騰落率をweb検索で取得し、保有セクターのリターンと比較
  const runSectorBench = useCallback(async (sectorGroups) => {
    setBenchLoading(true); setBenchErr(null);
    try {
      const sectors = (sectorGroups || []).map((g) => g.name).filter((n) => n && n !== "分散" && n !== "未分類");
      const prompt = `現在の株式市場データを調べてください。直近の終値・騰落率を使ってください。
1) 主要指数の「年初来騰落率(%)」と「直近1日の騰落率(%)」: 日経平均, TOPIX, S&P500, NASDAQ
2) 市場センチメント: 上記指数の動きから、今が「上げ相場」「下げ相場」「横ばい」のどれか、1文の要約
3) 日本株の業種別(セクター)の直近1年騰落率(%)${sectors.length ? "（対象: " + sectors.join("、") + "）" : "（主要業種）"}

出力はJSONのみ、マークダウン無し。次の形式:
{"indices":[{"n":"日経平均","ytd":数値,"d1":数値},{"n":"TOPIX","ytd":数値,"d1":数値},{"n":"S&P500","ytd":数値,"d1":数値},{"n":"NASDAQ","ytd":数値,"d1":数値}],"sentiment":"上げ相場|下げ相場|横ばい","summary":"1文要約","sectors":[{"s":"セクター名","r":数値}]}`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": window._portfolioApiKey || localStorage.getItem("anthropic_api_key") || "", "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514", max_tokens: 2000,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      if (!resp.ok) throw new Error(`検索APIエラー ${resp.status}`);
      const data = await resp.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      // 全体のJSONオブジェクトを抽出（ネストありなので最初の{から最後の}まで）
      let parsed = null;
      const first = text.indexOf("{"), last = text.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try { parsed = JSON.parse(text.slice(first, last + 1)); } catch {}
      }
      // セクターはフラット抽出でも拾う（堅牢化）
      const bench = {};
      if (parsed && Array.isArray(parsed.sectors)) {
        parsed.sectors.forEach((o) => { if (o.s != null && o.r != null) bench[String(o.s)] = Number(o.r); });
      } else {
        const ms = text.match(/\{[^{}]*"s"[^{}]*\}/g) || [];
        for (const m of ms) { try { const o = JSON.parse(m); if (o.s != null && o.r != null) bench[String(o.s)] = Number(o.r); } catch {} }
      }
      if (!Object.keys(bench).length && !(parsed && parsed.indices)) throw new Error("市場データを取得できませんでした");
      setSectorBench({ at: new Date(), data: bench });
      if (parsed && (parsed.indices || parsed.sentiment)) {
        setMarket({
          at: new Date(),
          indices: Array.isArray(parsed.indices) ? parsed.indices : [],
          sentiment: parsed.sentiment || null,
          summary: parsed.summary || null,
        });
      }
    } catch (e) {
      setBenchErr(e.message || "取得に失敗しました");
    } finally {
      setBenchLoading(false);
    }
  }, []);

  // クリップボードからの貼り付け（選択中の枠に取り込む）
  useEffect(() => {
    const onPaste = (e) => {
      if (tab !== "upload" || !selectedSlot) return;
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type && it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            if (selectedSlot === "tx") {
              processTxFile(file);
            } else if (selectedSlot === "cryptobuy") {
              processCryptoBuyFile(file);
            } else {
              const u = UPLOADS.find((x) => x.id === selectedSlot);
              processFile(file, selectedSlot, u ? u.label : selectedSlot);
            }
          }
          return;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [tab, selectedSlot, processFile, processTxFile, processCryptoBuyFile]);

  // 暗号資産: 通貨ごとの取得額（円）・数量を購入履歴から積み上げ
  const cryptoCostByCoin = (() => {
    const map = {};
    for (const b of cryptoBuys) {
      const k = b.name;
      if (!map[k]) map[k] = { jpy: 0, qty: 0 };
      map[k].jpy += b.jpy || 0;
      if (b.qty != null) map[k].qty += b.qty;
    }
    return map;
  })();

  // 保有データに暗号資産の損益を埋め込んだ派生配列（以降の集計・表示はこれを使う）
  const holdings = holdingsRaw.map((h) => {
    if (h.cat !== "crypto" || h.market_value == null) return h;
    const c = cryptoCostByCoin[h.name];
    if (!c || c.jpy <= 0) return h;
    const gl = h.market_value - c.jpy;
    return { ...h, gain_loss: gl, gain_loss_pct: (gl / c.jpy) * 100, crypto_cost: c.jpy };
  });

  // 負債（ローン）は資産合計から除外して別管理
  const loanHoldings = holdings.filter((h) => h.cat === "loan");
  const assetHoldings = holdings.filter((h) => h.cat !== "loan");
  const totalValue = assetHoldings.reduce((s, h) => s + (h.market_value || 0), 0); // 総資産
  const totalLoan = loanHoldings.reduce((s, h) => s + (h.market_value || 0), 0);   // 総負債
  const netWorth = totalValue - totalLoan;                                           // 純資産

  // 不動産評価（土地手入力 + 建物は築年数から自動計算）
  const reLand = parseFloat(realestate.land) || 0;
  const reBuildCost = parseFloat(realestate.buildCost) || 0;
  const reBuiltYear = parseInt(realestate.builtYear) || 0;
  const thisCalYear = new Date().getFullYear();
  const reAge = reBuiltYear > 0 ? Math.max(0, thisCalYear - reBuiltYear) : 0;
  // 木造耐用年数22年、最低残存10%
  const reDepRate = reBuiltYear > 0 ? Math.max(0.10, 1 - reAge / 22) : 0;
  const reBuildValue = Math.round(reBuildCost * reDepRate);
  const reTotal = reLand + reBuildValue;
  const reNet = reTotal - totalLoan; // 不動産ネット（評価額 - ローン残高）
  const hasRealestate = reTotal > 0;
  const totalGL = assetHoldings.reduce((s, h) => s + (h.gain_loss || 0), 0);
  const totalGLPct = totalValue - totalGL > 0 ? (totalGL / (totalValue - totalGL)) * 100 : 0;
  const cashAssets = holdings.filter((h) => h.cat === "bank" || h.cat === "cash_sbi").reduce((s, h) => s + (h.market_value || 0), 0);
  const investAssets = totalValue - cashAssets;

  // 米国株の取得円簿価を銘柄ごとに集計（買付の円受渡額を合算、売却は減算）
  const usCostByName = (() => {
    const map = {};
    for (const t of usCost) {
      if (t.jpy == null) continue;
      const k = t.name;
      if (!map[k]) map[k] = { jpy: 0, usd: 0 };
      map[k].jpy += t.sell ? -t.jpy : t.jpy;
      if (t.usd != null) map[k].usd += t.sell ? -t.usd : t.usd;
    }
    return map;
  })();
  // 保有米国株に円建て損益を付与（取引履歴で円簿価が分かるものだけ）
  const matchUsCost = (h) => {
    if (h.cat !== "us") return null;
    const keys = Object.keys(usCostByName);
    const norm = (s) => s.replace(/[\s・\-－&＆　]/g, "").toLowerCase();
    const hn = norm(h.name);
    const hcode = (h.code || "").toUpperCase();

    // ①ティッカー完全一致（CSVの名前末尾にティッカーが入っている形式 "ショッピファイ A SHOP"）
    if (hcode) {
      const hit = keys.find((k) => k.toUpperCase().endsWith(" " + hcode) || k.toUpperCase() === hcode);
      if (hit) return usCostByName[hit];
    }
    // ②正規化後の名前部分一致
    const hit2 = keys.find((k) => {
      const kn = norm(k);
      return kn.includes(hn) || hn.includes(kn);
    });
    return hit2 ? usCostByName[hit2] : null;
  };
  const usedCats = CATEGORIES.filter((c) => holdings.some((h) => h.cat === c.id));

  const byCat = CATEGORIES
    .map((c) => ({ name: c.label, value: holdings.filter((h) => h.cat === c.id).reduce((s, h) => s + (h.market_value || 0), 0), color: c.color }))
    .filter((c) => c.value > 0);

  // 分析タブ: グルーピング軸の定義
  const DIMENSIONS = [
    { id: "cat", label: "区分", keyFn: (h) => CATEGORIES.find((c) => c.id === h.cat)?.label || "その他", needsAI: false },
    { id: "asset_class", label: "資産クラス", keyFn: (h) => h.asset_class, needsAI: true },
    { id: "region", label: "地域", keyFn: (h) => h.region, needsAI: true },
    { id: "sector", label: "セクター", keyFn: (h) => h.sector, needsAI: true },
    { id: "currency", label: "通貨", keyFn: (h) => h.currency || "JPY", needsAI: false },
    { id: "pnl", label: "損益", keyFn: (h) => (h.gain_loss || 0) >= 0 ? "含み益" : "含み損", needsAI: false },
  ];
  const curDim = DIMENSIONS.find((d) => d.id === groupDim) || DIMENSIONS[0];
  const isClassified = holdings.some((h) => h.asset_class || h.region || h.sector);

  // 選択軸でグルーピング（取得額・リターンも算出）負債（ローン）は除外
  const groups = (() => {
    const map = {};
    for (const h of assetHoldings) {
      const k = curDim.keyFn(h) || "未分類";
      if (!map[k]) map[k] = { name: k, value: 0, gain: 0, cost: 0, count: 0 };
      map[k].value += h.market_value || 0;
      map[k].gain += h.gain_loss || 0;
      map[k].cost += (h.market_value || 0) - (h.gain_loss || 0); // 取得額 = 評価額 − 損益
      map[k].count += 1;
    }
    return Object.values(map)
      .map((g) => ({ ...g, ret: g.cost > 0 ? (g.gain / g.cost) * 100 : null })) // 加重平均リターン
      .sort((a, b) => b.value - a.value)
      .map((g, i) => ({ ...g, color: PALETTE[i % PALETTE.length] }));
  })();
  const groupTotal = groups.reduce((s, g) => s + g.value, 0);
  // 集中度指標
  const topShare = groupTotal > 0 && groups[0] ? (groups[0].value / groupTotal) * 100 : 0;
  const top3Share = groupTotal > 0 ? (groups.slice(0, 3).reduce((s, g) => s + g.value, 0) / groupTotal) * 100 : 0;
  // 個別銘柄の集中度（最大の1銘柄が総資産に占める割合）
  const topHolding = [...holdings].sort((a, b) => (b.market_value || 0) - (a.market_value || 0))[0];
  const topHoldingShare = totalValue > 0 && topHolding ? ((topHolding.market_value || 0) / totalValue) * 100 : 0;
  // 銘柄別リターン（取得来）と貢献度
  const holdingsWithRet = assetHoldings
    .filter((h) => h.gain_loss != null && h.market_value != null)
    .map((h) => {
      const cost = (h.market_value || 0) - (h.gain_loss || 0);
      return { ...h, ret: cost > 0 ? (h.gain_loss / cost) * 100 : null };
    });
  const totalAbsGain = holdingsWithRet.reduce((s, h) => s + Math.abs(h.gain_loss || 0), 0) || 1;
  const contribRanked = [...holdingsWithRet].sort((a, b) => (b.gain_loss || 0) - (a.gain_loss || 0));
  const maxAbsRet = Math.max(1, ...holdingsWithRet.map((h) => Math.abs(h.ret || 0)));
  const maxAbsGain = Math.max(1, ...holdingsWithRet.map((h) => Math.abs(h.gain_loss || 0)));

  // 主要指数と対応づけるための保有リターン（取得来・加重平均）
  const groupRet = (filterFn) => {
    const list = holdings.filter(filterFn);
    const val = list.reduce((s, h) => s + (h.market_value || 0), 0);
    const gain = list.reduce((s, h) => s + (h.gain_loss || 0), 0);
    const cost = val - gain;
    return { value: val, ret: cost > 0 ? (gain / cost) * 100 : null };
  };
  // 日本株＝海外/暗号/銀行以外、米国株＝海外区分。地域分類があればそれを優先。
  const jpRet = groupRet((h) => h.region ? (h.region === "日本") : (h.cat !== "us" && h.cat !== "crypto" && h.cat !== "bank"));
  const usRet = groupRet((h) => h.region ? (h.region === "米国" || h.region === "先進国" || h.region === "全世界") : (h.cat === "us"));
  // 指数名→保有リターンの対応
  const indexMatch = (name) => {
    if (name.includes("日経") || name === "TOPIX" || name.includes("TOPIX")) return jpRet;
    if (name.includes("S&P") || name.includes("NASDAQ") || name.includes("ナスダック")) return usRet;
    return null;
  };

  const ranked = [...holdings].filter((h) => h.gain_loss != null).sort((a, b) => b.gain_loss - a.gain_loss);
  const top3 = ranked.slice(0, 3);
  const bot3 = [...ranked].reverse().slice(0, 3);

  // NISA枠は簿価（取得額 = 評価額 − 含み損益）で管理。旧NISAは新枠の対象外。
  const acqCost = (catId) => holdings.filter((h) => h.cat === catId).reduce((s, h) => s + ((h.market_value || 0) - (h.gain_loss || 0)), 0);
  const growthCost = acqCost("nisa_growth");
  const tsumitateCost = acqCost("tsumitate");
  const nisaTotalCost = growthCost + tsumitateCost;
  const LIMIT_TOTAL = 18000000, LIMIT_GROWTH = 12000000;
  const hasNisa = holdings.some((h) => h.cat === "nisa_growth" || h.cat === "tsumitate");

  // 年間枠の使用額（買付のみ加算。年間枠は売却で戻らない）
  const thisYear = String(new Date().getFullYear());
  const yearBuys = (frame) => transactions
    .filter((t) => !t.sell && t.frame === frame && t.date.slice(0, 4) === thisYear)
    .reduce((s, t) => s + (t.amount || 0), 0);
  const annualGrowthUsed = yearBuys("growth");
  const annualTsumitateUsed = yearBuys("tsumitate");
  const hasTx = transactions.length > 0;

  // 実現損益（今年の利益確定）の集計
  const realizedThisYear = realized.filter((r) => r.date.slice(0, 4) === thisYear);
  const realizedTotal = realizedThisYear.reduce((s, r) => s + (r.pl || 0), 0);
  // 課税区分ごとの集計
  const TAX_ORDER = ["特定", "一般", "NISA成長", "NISA積立", "旧NISA"];
  const realizedByTax = (() => {
    const map = {};
    for (const r of realizedThisYear) {
      const k = r.tax || "特定";
      if (!map[k]) map[k] = { tax: k, pl: 0, count: 0 };
      map[k].pl += r.pl || 0;
      map[k].count += 1;
    }
    return Object.values(map).sort((a, b) => TAX_ORDER.indexOf(a.tax) - TAX_ORDER.indexOf(b.tax));
  })();
  // 課税対象（特定・一般のみ。NISAは非課税）の実現損益
  const taxableRealized = realizedThisYear.filter((r) => r.tax === "特定" || r.tax === "一般").reduce((s, r) => s + (r.pl || 0), 0);
  const hasRealized = realized.length > 0;

  // C: CSS変数を参照するショートハンド（JSXのstyle propで使用）
  const C = {
    bg:      "var(--bg)",
    surface: "var(--surface)",
    surface2:"var(--surface2)",
    border:  "var(--border)",
    text:    "var(--text)",
    muted:   "var(--muted)",
    dim:     "var(--dim)",
    accent:  "var(--accent)",
    pos:     "var(--pos)",
    neg:     "var(--neg)",
  };

  const tabBtn = (id, label, icon) => (
    <button onClick={() => setTab(id)} style={{
      flex: 1, padding: "8px 3px", borderRadius: 7, border: "none", cursor: "pointer",
      fontSize: 10.5, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap",
      background: tab === id ? C.accent : "transparent", color: tab === id ? "#fff" : C.muted, transition: "all 0.15s",
    }}>{icon} {label}</button>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif" }}>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "20px 16px 48px" }}>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
              <div style={{ fontSize: 10.5, color: C.accent, letterSpacing: "0.14em", textTransform: "uppercase" }}>Zenith</div>
              <button onClick={toggleTheme} title={isDark ? "ライトモード" : "ダークモード"}
                style={{ background: "transparent", border: `1px solid ${C.border}`, borderRadius: 20,
                  padding: "2px 9px", cursor: "pointer", fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
                {isDark ? "☀️" : "🌙"}
              </button>
            </div>
            <div style={{ fontSize: 21, fontWeight: 700 }}>資産ダッシュボード</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10.5, color: C.dim }}>総評価額</div>
            <div style={{ fontSize: 23, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmt(totalValue)}</div>
            {holdings.length > 0 && <div style={{ fontSize: 12, color: totalGL >= 0 ? C.pos : C.neg }}>{fmtSign(totalGL)} / {fmtPct(totalGLPct)}</div>}
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, background: "var(--tab-bg)", padding: 4, borderRadius: 10, marginBottom: 12 }}>
          {tabBtn("dashboard", "ダッシュボード", "📊")}
          {tabBtn("holdings", "保有一覧", "📋")}
          {tabBtn("analysis", "分析", "🔍")}
          {tabBtn("realestate", "🏠不動産", "")}
          {tabBtn("stock", "📡探索", "")}
          {tabBtn("upload", "📷取込", "")}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, marginBottom: 18, fontSize: 10.5, color: C.dim }}>
          <span>{lastSync ? `最終同期 ${lastSync.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}` : "未同期"}</span>
          <button onClick={() => reloadFromStorage(true)} style={{
            padding: "4px 10px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6,
            color: C.muted, fontSize: 10.5, cursor: "pointer", fontFamily: "inherit",
          }}>{syncing ? "⟳ 同期中..." : "🔄 同期"}</button>
        </div>

        {/* ── ダッシュボード ── */}
        {tab === "dashboard" && (
          <div>
            <div style={{
              background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(139,92,246,0.10))",
              border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 22px", marginBottom: 16,
            }}>
              <div style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>総資産</div>
              <div style={{ fontSize: 32, fontWeight: 800, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.01em" }}>{fmt(totalValue)}</div>
              {assetHoldings.length > 0 && (
                <div style={{ fontSize: 12.5, color: totalGL >= 0 ? C.pos : C.neg, marginTop: 2 }}>
                  評価損益 {fmtSign(totalGL)}（{fmtPct(totalGLPct)}）
                </div>
              )}
              <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontSize: 10.5, color: C.dim, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: C.accent }} />投資資産</div>
                  <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{fmt(investAssets)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10.5, color: C.dim, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#64748B" }} />現金（銀行・買付余力）</div>
                  <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{fmt(cashAssets)}</div>
                </div>
                {hasRealestate && (
                  <div>
                    <div style={{ fontSize: 10.5, color: C.dim, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: "#F97316" }} />不動産評価額</div>
                    <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{fmt(reTotal)}</div>
                  </div>
                )}
                {totalLoan > 0 && (
                  <div>
                    <div style={{ fontSize: 10.5, color: C.neg, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: C.neg }} />住宅ローン（負債）</div>
                    <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 2, color: C.neg }}>−{fmt(totalLoan)}</div>
                  </div>
                )}
                {hasRealestate && totalLoan > 0 && (
                  <div>
                    <div style={{ fontSize: 10.5, color: reNet >= 0 ? C.pos : C.neg, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: reNet >= 0 ? C.pos : C.neg }} />不動産ネット</div>
                    <div style={{ fontSize: 17, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginTop: 2, color: reNet >= 0 ? C.pos : C.neg }}>{fmt(reNet)}</div>
                  </div>
                )}
                {totalValue > 0 && (
                  <div style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "flex-end" }}>
                    <div style={{ width: "100%" }}>
                      <div style={{ display: "flex", height: 8, borderRadius: 5, overflow: "hidden", background: "var(--surface2)" }}>
                        <div style={{ width: `${totalValue > 0 ? (investAssets / totalValue) * 100 : 0}%`, background: C.accent }} />
                        <div style={{ width: `${totalValue > 0 ? (cashAssets / totalValue) * 100 : 0}%`, background: "#64748B" }} />
                      </div>
                      {totalLoan > 0 && (
                        <div style={{ marginTop: 4, height: 8, borderRadius: 5, overflow: "hidden", background: "var(--surface2)" }}>
                          <div style={{ width: `${totalValue > 0 ? Math.min(100, (totalLoan / totalValue) * 100) : 0}%`, height: "100%", background: "rgba(239,68,68,0.6)", borderRadius: 5 }} />
                        </div>
                      )}
                      <div style={{ fontSize: 10, color: C.dim, marginTop: 4, textAlign: "right" }}>
                        投資 {totalValue > 0 ? ((investAssets / totalValue) * 100).toFixed(0) : 0}% / 現金 {totalValue > 0 ? ((cashAssets / totalValue) * 100).toFixed(0) : 0}%
                        {totalLoan > 0 && ` / ローン比率 ${totalValue > 0 ? ((totalLoan / totalValue) * 100).toFixed(0) : 0}%`}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 20 }}>
              {[
                { l: "含み損益", v: fmtSign(totalGL), s: fmtPct(totalGLPct), c: totalGL >= 0 ? C.pos : C.neg },
                { l: "銘柄数", v: String(assetHoldings.length), s: `${usedCats.length}区分`, c: C.text },
                { l: "最終更新", v: holdings[0]?.updated || "―", s: "取込日", c: C.text },
              ].map((card, i) => (
                <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, padding: "13px 15px" }}>
                  <div style={{ fontSize: 11, color: C.dim, marginBottom: 4 }}>{card.l}</div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: card.c, fontVariantNumeric: "tabular-nums" }}>{card.v}</div>
                  <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{card.s}</div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(270px,1fr))", gap: 16 }}>
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 14 }}>区分別配分</div>
                {byCat.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={byCat} cx="50%" cy="50%" innerRadius={48} outerRadius={76} dataKey="value" paddingAngle={3}>
                          {byCat.map((e, i) => <Cell key={i} fill={e.color} />)}
                        </Pie>
                        <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: "var(--tip-bg)", border: `1px solid ${C.border}`, color: "var(--text)", borderRadius: 8, fontSize: 12  }} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ marginTop: 8 }}>
                      {byCat.map((a, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "3px 0" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: a.color }} />{a.name}</span>
                          <span style={{ color: C.muted, fontVariantNumeric: "tabular-nums" }}>{fmt(a.value)} <span style={{ color: C.dim }}>({totalValue > 0 ? ((a.value / totalValue) * 100).toFixed(1) : 0}%)</span></span>
                        </div>
                      ))}
                    </div>
                  </>
                ) : <div style={{ textAlign: "center", color: C.dim, padding: 40, fontSize: 13, lineHeight: 1.8 }}>スクショを取り込むと<br />表示されます</div>}
              </div>

              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 14 }}>評価額推移</div>
                {history.length > 1 ? (
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={history}>
                      <XAxis dataKey="date" tickFormatter={(d) => d.slice(5)} tick={{ fontSize: 10, fill: C.dim }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: C.dim }} tickLine={false} axisLine={false} tickFormatter={(v) => `¥${(v / 1e6).toFixed(1)}M`} width={48} />
                      <Tooltip formatter={(v) => fmt(v)} contentStyle={{ background: "var(--tip-bg)", border: `1px solid ${C.border}`, color: "var(--text)", borderRadius: 8, fontSize: 12  }} />
                      <Line type="monotone" dataKey="total" stroke={C.accent} strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                ) : <div style={{ textAlign: "center", color: C.dim, padding: 40, fontSize: 13, lineHeight: 1.8 }}>複数回取り込むと<br />推移が表示されます</div>}
              </div>
            </div>

            {hasNisa && (
              <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>NISA非課税枠（取得額ベース）</span>
                </div>
                <NisaGauge label="生涯枠 合計" used={nisaTotalCost} limit={LIMIT_TOTAL} color="#8B5CF6" C={C} />
                <NisaGauge label="成長投資枠" used={growthCost} limit={LIMIT_GROWTH} color="#8B5CF6" C={C} />
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, padding: "2px 0", color: C.muted }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: "50%", background: "#EC4899" }} />つみたて投資枠（取得額）</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmt(tsumitateCost)}</span>
                </div>
                <div style={{ fontSize: 10.5, color: C.dim, marginTop: 10, lineHeight: 1.6 }}>
                  ※ 枠は簿価（取得額）で管理。値上がり益は枠を消費しません。旧NISAは生涯枠の対象外のため除外。成長枠は最大1,200万・全体で1,800万が上限です。
                </div>
              </div>
            )}

            {hasTx && (
              <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 14 }}>{thisYear}年 年間投資枠の使用状況</div>
                <NisaGauge label="成長投資枠（年間）" used={annualGrowthUsed} limit={ANNUAL_GROWTH} color="#8B5CF6" C={C} />
                <NisaGauge label="つみたて投資枠（年間）" used={annualTsumitateUsed} limit={ANNUAL_TSUMITATE} color="#EC4899" C={C} />
                <div style={{ fontSize: 10.5, color: C.dim, marginTop: 6, lineHeight: 1.6 }}>
                  ※ 取引履歴の{thisYear}年の買付額を集計。年間枠は毎年1月にリセットされ、売却しても当年の枠は戻りません。
                </div>
              </div>
            )}

            {hasRealized && (
              <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>{thisYear}年 利益確定（実現損益）</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: realizedTotal >= 0 ? C.pos : C.neg, fontVariantNumeric: "tabular-nums" }}>{fmtSign(realizedTotal)}</span>
                </div>

                {/* 課税区分ごとの集計 */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  {realizedByTax.map((t, i) => (
                    <div key={i} style={{ flex: "1 1 90px", minWidth: 90, background: "var(--surface2)", borderRadius: 9, padding: "9px 11px" }}>
                      <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 2 }}>{t.tax}{(t.tax === "NISA成長" || t.tax === "NISA積立" || t.tax === "旧NISA") ? "（非課税）" : ""}</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: t.pl >= 0 ? C.pos : C.neg, fontVariantNumeric: "tabular-nums" }}>{fmtSign(t.pl)}</div>
                      <div style={{ fontSize: 9.5, color: C.dim, marginTop: 1 }}>{t.count}件</div>
                    </div>
                  ))}
                </div>

                {/* 課税対象の概算税額メモ */}
                {taxableRealized > 0 && (
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 12, padding: "8px 11px", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 8, lineHeight: 1.6 }}>
                    課税対象（特定・一般）の実現益 <b>{fmt(taxableRealized)}</b> → 概算税額（20.315%）<b>約{fmt(taxableRealized * 0.20315)}</b>
                  </div>
                )}

                {/* 銘柄別・売却日別の一覧 */}
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        {["売却日", "銘柄", "区分", "実現損益"].map((th, i) => (
                          <th key={i} style={{ textAlign: i >= 2 ? "right" : "left", fontSize: 10.5, color: C.dim, fontWeight: 500, padding: "7px 10px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>{th}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {realizedThisYear.map((r, i) => (
                        <tr key={i}>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${C.bg}`, fontSize: 11.5, color: C.muted, whiteSpace: "nowrap" }}>{r.date.slice(5)}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${C.bg}`, fontSize: 12, fontWeight: 600, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${C.bg}`, fontSize: 10.5, color: C.dim, textAlign: "right", whiteSpace: "nowrap" }}>{r.tax}</td>
                          <td style={{ padding: "8px 10px", borderBottom: `1px solid ${C.bg}`, fontSize: 12, textAlign: "right", fontVariantNumeric: "tabular-nums", color: r.pl >= 0 ? C.pos : C.neg }}>{fmtSign(r.pl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontSize: 10, color: C.dim, marginTop: 8, lineHeight: 1.6 }}>
                  ※ 取引履歴CSVの売却（実現損益）から集計。税額は概算で、損益通算・繰越控除・配当等は未考慮です。正確な金額は証券会社の年間取引報告書をご確認ください。
                </div>
              </div>
            )}

            {holdings.length > 0 && (
              <div style={{ marginTop: 16, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 12 }}>含み損益ランキング</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {[{ label: "▲ 含み益 TOP3", list: top3, c: C.pos }, { label: "▼ 含み損 TOP3", list: bot3, c: C.neg }].map((col, ci) => (
                    <div key={ci}>
                      <div style={{ fontSize: 11, color: col.c, marginBottom: 8 }}>{col.label}</div>
                      {col.list.length ? col.list.map((h, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.bg}`, fontSize: 12 }}>
                          <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "52%" }}>{h.name}</span>
                          <span style={{ color: h.gain_loss >= 0 ? C.pos : C.neg, fontVariantNumeric: "tabular-nums", textAlign: "right", fontSize: 11 }}>{fmtSign(h.gain_loss)}<br /><span style={{ fontSize: 10 }}>{fmtPct(h.gain_loss_pct)}</span></span>
                        </div>
                      )) : <div style={{ fontSize: 12, color: C.dim, padding: "6px 0" }}>―</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── 保有一覧（区分別）── */}
        {tab === "holdings" && (
          <div>
            {/* コード補完ボタン */}

            {holdings.length === 0 ? (
              <div style={{ textAlign: "center", color: C.dim, padding: 80, fontSize: 14 }}>スクショを取り込むと保有銘柄が表示されます</div>
            ) : CATEGORIES.map((cat) => {
              const hs = holdings.filter((h) => h.cat === cat.id);
              if (!hs.length) return null;
              const sum = hs.reduce((s, h) => s + (h.market_value || 0), 0);
              const gl = hs.reduce((s, h) => s + (h.gain_loss || 0), 0);
              return (
                <div key={cat.id} style={{ marginBottom: 22 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                    <span style={{ width: 9, height: 9, borderRadius: "50%", background: cat.color }} />
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{cat.label}</span>
                    {cat.isLiability
                      ? <span style={{ fontSize: 11, color: C.neg }}>−{fmt(sum)}</span>
                      : <span style={{ fontSize: 11, color: C.dim }}>{fmt(sum)}</span>}
                    {cat.isLiability && <span style={{ fontSize: 10, color: C.neg, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, padding: "1px 5px" }}>負債</span>}
                    {cat.id === "us" && (() => {
                      const r = hs.find((h) => h.fx_rate && h.currency)?.fx_rate;
                      const c = hs.find((h) => h.fx_rate && h.currency)?.currency;
                      return r ? <span style={{ fontSize: 10, color: C.dim }}>{c}/JPY {r.toFixed(2)}</span> : null;
                    })()}
                    <span style={{ fontSize: 11, color: gl >= 0 ? C.pos : C.neg, marginLeft: "auto" }}>{fmtSign(gl)}</span>
                  </div>
                  {cat.id === "us" && hs.some((h) => h.market_value == null) && (
                    <div style={{ fontSize: 10.5, color: C.neg, marginBottom: 6 }}>⚠ 一部の通貨で為替レートを取得できず、円換算できませんでした（現地通貨建ては表示）。</div>
                  )}
                  {cat.id === "us" && (() => {
                    // 為替差損益の分解: 円建て損益 − (ドル建て損益×現在レート)
                    let jpyGlSum = 0, usdGlYenSum = 0, matched = 0;
                    for (const h of hs) {
                      const cost = matchUsCost(h);
                      if (cost && cost.jpy > 0 && h.market_value != null && h.local_gain_loss != null && h.fx_rate) {
                        jpyGlSum += h.market_value - cost.jpy;
                        usdGlYenSum += h.local_gain_loss * h.fx_rate;
                        matched++;
                      }
                    }
                    if (!matched) {
                      return <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 8, lineHeight: 1.6 }}>💡 取引履歴CSVを取り込むと、円建て損益と「株価要因／為替要因」の内訳が表示されます。</div>;
                    }
                    const fxGl = jpyGlSum - usdGlYenSum;
                    return (
                      <div style={{ display: "flex", gap: 14, marginBottom: 8, padding: "8px 12px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 11, flexWrap: "wrap" }}>
                        <span style={{ color: C.dim }}>損益の内訳（{matched}銘柄）:</span>
                        <span>株価要因 <b style={{ color: usdGlYenSum >= 0 ? C.pos : C.neg }}>{fmtSign(Math.round(usdGlYenSum))}</b></span>
                        <span>為替要因 <b style={{ color: fxGl >= 0 ? C.pos : C.neg }}>{fmtSign(Math.round(fxGl))}</b></span>
                        <span>= 円建て <b style={{ color: jpyGlSum >= 0 ? C.pos : C.neg }}>{fmtSign(Math.round(jpyGlSum))}</b></span>
                      </div>
                    );
                  })()}
                  {cat.id === "crypto" && hs.some((h) => h.gain_loss == null) && (
                    <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 8, lineHeight: 1.6 }}>💡 Coincheckの購入履歴を取り込むと、取得額から損益が計算されます（購入履歴未取込の通貨は損益「―」）。</div>
                  )}
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>{[
                          { l: "銘柄", k: null },
                          { l: "評価額", k: "mv" },
                          { l: "含み損益", k: "gl" },
                          { l: "損益率", k: "pct" },
                        ].map(({ l, k }, i) => (
                          <th key={i} onClick={() => k && setHoldingSort(holdingSort === k ? null : k)} style={{ textAlign: i === 0 ? "left" : "right", fontSize: 11, color: k && holdingSort === k ? C.accent : C.dim, fontWeight: k && holdingSort === k ? 700 : 500, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap", cursor: k ? "pointer" : "default", userSelect: "none" }}>
                            {l}{k && holdingSort === k ? " ▼" : k ? " ↕" : ""}
                          </th>
                        ))}</tr>
                      </thead>
                      <tbody>
                        {[...hs].sort((a, b) => {
                          if (holdingSort === "mv") return (b.market_value || 0) - (a.market_value || 0);
                          if (holdingSort === "gl") return (b.gain_loss || 0) - (a.gain_loss || 0);
                          if (holdingSort === "pct") return (b.gain_loss_pct || 0) - (a.gain_loss_pct || 0);
                          return 0;
                        }).map((h, i) => (
                          <tr key={i}>
                            <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.bg}`, fontSize: 12.5, fontWeight: 600, maxWidth: 220, cursor: "pointer" }}
                              onClick={() => {
                                const market = cat.id === "us" ? "us" : cat.id === "crypto" ? "crypto" : "jp";
                                const code = h.code;
                                const name = h.name;
                                if (market === "jp" && code) window.open(`https://finance.yahoo.co.jp/quote/${code}.T/chart`, "_blank");
                                else if (market === "us" && code) window.open(`https://finance.yahoo.com/chart/${code}`, "_blank");
                                else window.open(`https://finance.yahoo.co.jp/search/?query=${encodeURIComponent(name)}`, "_blank");
                              }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flexShrink: 1 }}>{h.name}</span>
                                {h.code && <span style={{ fontSize: 9, fontWeight: 700, color: C.accent, background: `${C.accent}18`, borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap", flexShrink: 0 }}>{h.code}</span>}
                                {h.currency && <span style={{ fontSize: 9, fontWeight: 600, color: cat.color, border: `1px solid ${cat.color}66`, borderRadius: 3, padding: "1px 4px", whiteSpace: "nowrap", flexShrink: 0 }}>{h.currency}</span>}
                              </div>
                            </td>
                            <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.bg}`, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12.5 }}>
                              {fmt(h.market_value)}
                              {h.local_value != null && h.currency && (
                                <div style={{ fontSize: 9.5, color: C.dim }}>{h.currency} {h.local_value.toLocaleString("en-US", { maximumFractionDigits: 2 })}</div>
                              )}
                              {cat.id === "crypto" && h.qty != null && (
                                <div style={{ fontSize: 9.5, color: C.dim }}>{h.qty.toLocaleString("en-US", { maximumFractionDigits: 8 })} {h.name}</div>
                              )}
                            </td>
                            <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.bg}`, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12 }}>
                              {(() => {
                                if (cat.id !== "us") {
                                  return <span style={{ color: (h.gain_loss || 0) >= 0 ? C.pos : C.neg }}>{fmtSign(h.gain_loss)}</span>;
                                }
                                // 米国株: ドル建て損益（現地）＋円建て損益（取引履歴の円簿価ベース）
                                const usdGl = h.local_gain_loss;
                                const cost = matchUsCost(h);
                                const jpyGl = (cost && cost.jpy > 0 && h.market_value != null) ? Math.round(h.market_value - cost.jpy) : null;
                                return (
                                  <div>
                                    <div style={{ color: (usdGl || 0) >= 0 ? C.pos : C.neg }}>
                                      {usdGl != null ? `${usdGl >= 0 ? "+" : "-"}$${Math.abs(usdGl).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "―"}
                                      <span style={{ fontSize: 8.5, color: C.dim, marginLeft: 3 }}>USD</span>
                                    </div>
                                    <div style={{ color: jpyGl == null ? C.dim : (jpyGl >= 0 ? C.pos : C.neg), fontSize: 11 }}>
                                      {jpyGl != null ? fmtSign(jpyGl) : "円建—"}
                                      {jpyGl != null && <span style={{ fontSize: 8.5, color: C.dim, marginLeft: 3 }}>円</span>}
                                    </div>
                                  </div>
                                );
                              })()}
                            </td>
                            <td style={{ padding: "9px 12px", borderBottom: `1px solid ${C.bg}`, textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12, color: (h.gain_loss_pct || 0) >= 0 ? C.pos : C.neg }}>{fmtPct(h.gain_loss_pct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── 分析（グルーピング）── */}
        {tab === "analysis" && (
          <div>
            {holdings.length === 0 ? (
              <div style={{ textAlign: "center", color: C.dim, padding: 80, fontSize: 14 }}>スクショを取り込むと分析できます</div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 12 }}>切り口を選んで構成を分析できます。</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 18 }}>
                  {DIMENSIONS.map((d) => (
                    <button key={d.id} onClick={() => setGroupDim(d.id)} style={{
                      padding: "6px 13px", borderRadius: 20, border: `1px solid ${groupDim === d.id ? C.accent : C.border}`,
                      background: groupDim === d.id ? "rgba(59,130,246,0.12)" : "transparent",
                      color: groupDim === d.id ? "#fff" : C.muted, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
                    }}>{d.label}{d.needsAI && !isClassified ? " ✨" : ""}</button>
                  ))}
                </div>

                {curDim.needsAI && !isClassified ? (
                  <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 28, textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: C.muted, marginBottom: 14, lineHeight: 1.7 }}>
                      「{curDim.label}」で分析するには、AIによる銘柄分類が必要です。<br />保有銘柄を資産クラス・地域・セクターに自動分類します。
                    </div>
                    <button onClick={runClassify} disabled={classifying} style={{
                      padding: "10px 20px", borderRadius: 10, border: "none", cursor: classifying ? "default" : "pointer",
                      background: classifying ? C.border : C.accent, color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: "inherit",
                    }}>{classifying ? "⟳ 分類中..." : "✨ AIで銘柄を分類する"}</button>
                    {classifyErr && <div style={{ fontSize: 11.5, color: C.neg, marginTop: 10 }}>⚠ {classifyErr}</div>}
                  </div>
                ) : (
                  <>
                    {/* 市場の中での自分の位置 */}
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: C.muted }}>📊 市場の中での自分の位置</span>
                        <button onClick={() => runSectorBench(groups)} disabled={benchLoading} style={{
                          padding: "5px 12px", borderRadius: 7, border: "none", cursor: benchLoading ? "default" : "pointer",
                          background: benchLoading ? C.border : C.accent, color: "#fff", fontSize: 11, fontWeight: 600, fontFamily: "inherit",
                        }}>{benchLoading ? "⟳ 取得中..." : (market || sectorBench) ? "🔄 市場データ更新" : "📈 市場データを取得"}</button>
                      </div>
                      {benchErr && <div style={{ fontSize: 11.5, color: C.neg, marginBottom: 8 }}>⚠ {benchErr}</div>}
                      {!market && !sectorBench && !benchLoading && (
                        <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.7 }}>「市場データを取得」を押すと、主要指数・相場の地合い・セクター動向を取得し、あなたの保有がその中でどこにいるかを表示します。</div>
                      )}

                      {/* 相場サマリー */}
                      {market && market.sentiment && (
                        <div style={{ padding: "12px 14px", borderRadius: 10, marginBottom: 14, background: market.sentiment.includes("上げ") ? "rgba(16,185,129,0.10)" : market.sentiment.includes("下げ") ? "rgba(248,113,113,0.10)" : "rgba(148,163,184,0.10)", border: `1px solid ${market.sentiment.includes("上げ") ? "rgba(16,185,129,0.3)" : market.sentiment.includes("下げ") ? "rgba(248,113,113,0.3)" : C.border}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 20 }}>{market.sentiment.includes("上げ") ? "📈" : market.sentiment.includes("下げ") ? "📉" : "➡️"}</span>
                            <span style={{ fontSize: 15, fontWeight: 700, color: market.sentiment.includes("上げ") ? C.pos : market.sentiment.includes("下げ") ? C.neg : C.text }}>{market.sentiment}</span>
                          </div>
                          {market.summary && <div style={{ fontSize: 11.5, color: C.muted, marginTop: 6, lineHeight: 1.6 }}>{market.summary}</div>}
                        </div>
                      )}

                      {/* 主要指数 vs 保有 */}
                      {market && market.indices && market.indices.length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.dim, marginBottom: 10 }}>主要指数（年初来）と、あなたの該当保有</div>
                          {market.indices.map((idx, i) => {
                            const mine = indexMatch(idx.n);
                            const mkt = idx.ytd;
                            const diff = mine && mine.ret != null ? mine.ret - mkt : null;
                            return (
                              <div key={i} style={{ marginBottom: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                                  <span style={{ fontWeight: 600, color: C.text }}>{idx.n}
                                    {idx.d1 != null && <span style={{ fontSize: 10, color: idx.d1 >= 0 ? C.pos : C.neg, marginLeft: 6 }}>前日比 {idx.d1 >= 0 ? "+" : ""}{idx.d1.toFixed(2)}%</span>}
                                  </span>
                                  {diff != null && <span style={{ fontVariantNumeric: "tabular-nums", color: diff >= 0 ? C.pos : C.neg, fontWeight: 600 }}>保有が{diff >= 0 ? "+" : ""}{diff.toFixed(1)}pt</span>}
                                </div>
                                {/* 指数バー */}
                                <div style={{ display: "flex", gap: 6, fontSize: 10.5, alignItems: "center" }}>
                                  <span style={{ color: C.dim, width: 44 }}>指数</span>
                                  <div style={{ flex: 1, height: 11, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, Math.abs(mkt) * 1.5)}%`, background: C.dim }} />
                                  </div>
                                  <span style={{ fontVariantNumeric: "tabular-nums", color: C.muted, minWidth: 50, textAlign: "right" }}>{mkt >= 0 ? "+" : ""}{mkt.toFixed(1)}%</span>
                                </div>
                                {mine && mine.ret != null ? (
                                  <div style={{ display: "flex", gap: 6, fontSize: 10.5, marginTop: 3, alignItems: "center" }}>
                                    <span style={{ color: C.dim, width: 44 }}>保有</span>
                                    <div style={{ flex: 1, height: 11, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
                                      <div style={{ height: "100%", width: `${Math.min(100, Math.abs(mine.ret) * 1.5)}%`, background: mine.ret >= 0 ? C.pos : C.neg }} />
                                    </div>
                                    <span style={{ fontVariantNumeric: "tabular-nums", color: mine.ret >= 0 ? C.pos : C.neg, minWidth: 50, textAlign: "right" }}>{mine.ret >= 0 ? "+" : ""}{mine.ret.toFixed(1)}%</span>
                                  </div>
                                ) : (
                                  <div style={{ fontSize: 10, color: C.dim, marginTop: 3, paddingLeft: 50 }}>該当する保有なし</div>
                                )}
                              </div>
                            );
                          })}
                          <div style={{ fontSize: 9.5, color: C.dim, marginTop: 2, lineHeight: 1.5 }}>※ 指数は年初来、保有は取得来リターンのため期間は厳密一致しません。日経/TOPIX↔日本株、S&P500/NASDAQ↔米国株で対応。</div>
                        </div>
                      )}

                      {/* セクター比較 */}
                      {sectorBench && groups.filter((g) => g.ret != null && sectorBench.data[g.name] != null).length > 0 && (
                        <div>
                          <div style={{ fontSize: 11.5, fontWeight: 600, color: C.dim, marginBottom: 10 }}>セクター指数（1年）と、あなたの保有</div>
                          {groups.filter((g) => g.ret != null && sectorBench.data[g.name] != null).map((g, i) => {
                            const mkt = sectorBench.data[g.name];
                            const diff = g.ret - mkt;
                            return (
                              <div key={i} style={{ marginBottom: 12 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                                  <span style={{ fontWeight: 600, color: C.text }}>{g.name}</span>
                                  <span style={{ fontVariantNumeric: "tabular-nums", color: diff >= 0 ? C.pos : C.neg }}>{diff >= 0 ? "市場を+" : "市場を"}{diff.toFixed(1)}pt{diff >= 0 ? "上回る" : "下回る"}</span>
                                </div>
                                <div style={{ display: "flex", gap: 6, fontSize: 10.5, alignItems: "center" }}>
                                  <span style={{ color: C.dim, width: 44 }}>指数</span>
                                  <div style={{ flex: 1, height: 11, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, Math.abs(mkt))}%`, background: C.dim }} />
                                  </div>
                                  <span style={{ fontVariantNumeric: "tabular-nums", color: C.muted, minWidth: 50, textAlign: "right" }}>{mkt >= 0 ? "+" : ""}{mkt.toFixed(1)}%</span>
                                </div>
                                <div style={{ display: "flex", gap: 6, fontSize: 10.5, marginTop: 3, alignItems: "center" }}>
                                  <span style={{ color: C.dim, width: 44 }}>保有</span>
                                  <div style={{ flex: 1, height: 11, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
                                    <div style={{ height: "100%", width: `${Math.min(100, Math.abs(g.ret))}%`, background: g.ret >= 0 ? C.pos : C.neg }} />
                                  </div>
                                  <span style={{ fontVariantNumeric: "tabular-nums", color: g.ret >= 0 ? C.pos : C.neg, minWidth: 50, textAlign: "right" }}>{g.ret >= 0 ? "+" : ""}{g.ret.toFixed(1)}%</span>
                                </div>
                              </div>
                            );
                          })}
                          <div style={{ fontSize: 9.5, color: C.dim, marginTop: 2 }}>{groupDim !== "sector" && "セクター比較を詳しく見るには切り口を「セクター」にしてください。"}</div>
                        </div>
                      )}
                      {(market || sectorBench) && <div style={{ fontSize: 9.5, color: C.dim, marginTop: 8 }}>市場データはAIのweb検索による推定値です（{(market || sectorBench).at.toLocaleString("ja-JP")}取得）。投資判断は一次情報でご確認ください。</div>}
                    </div>

                    {/* 集中度サマリー */}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(110px,1fr))", gap: 10, marginBottom: 18 }}>
                      {[
                        { l: "グループ数", v: `${groups.length}`, s: curDim.label + "別" },
                        { l: "最大グループ", v: `${topShare.toFixed(0)}%`, s: groups[0]?.name || "―" },
                        { l: "上位3集中度", v: `${top3Share.toFixed(0)}%`, s: "資産の偏り" },
                        { l: "最大単一銘柄", v: `${topHoldingShare.toFixed(0)}%`, s: topHolding?.name || "―" },
                      ].map((c, i) => (
                        <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 11, padding: "12px 14px" }}>
                          <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 3 }}>{c.l}</div>
                          <div style={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{c.v}</div>
                          <div style={{ fontSize: 10, color: C.dim, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.s}</div>
                        </div>
                      ))}
                    </div>

                    {/* パフォーマンス散布図: x=リターン / y=損益額 / 円=評価額 */}
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 4 }}>銘柄パフォーマンス マップ</div>
                      <div style={{ fontSize: 10.5, color: C.dim, marginBottom: 10 }}>横＝取得来リターン、縦＝損益額、円の大きさ＝評価額。右上ほど「高リターンで大きく稼いだ主力」、左下ほど「大きく負けている」。</div>
                      <PerfScatter holdings={holdingsWithRet} fmt={fmt} fmtSign={fmtSign} />
                    </div>

                    {/* 勝ち/負け 貢献トップ（コンパクト） */}
                    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 12 }}>貢献トップ（取得来の損益）</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                        {[{ label: "▲ 利益貢献", list: contribRanked.filter((h) => (h.gain_loss || 0) > 0).slice(0, 5), c: C.pos },
                          { label: "▼ 損失", list: contribRanked.filter((h) => (h.gain_loss || 0) < 0).slice(-5).reverse(), c: C.neg }].map((col, ci) => (
                          <div key={ci}>
                            <div style={{ fontSize: 11, color: col.c, marginBottom: 8 }}>{col.label}</div>
                            {col.list.length ? col.list.map((h, i) => (
                              <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: `1px solid ${C.bg}`, fontSize: 11.5 }}>
                                <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "50%" }}>{h.name}</span>
                                <span style={{ fontVariantNumeric: "tabular-nums", color: col.c, textAlign: "right" }}>
                                  {fmtSign(h.gain_loss)}<br /><span style={{ fontSize: 9.5, color: C.dim }}>{h.ret >= 0 ? "+" : ""}{h.ret?.toFixed(0)}%</span>
                                </span>
                              </div>
                            )) : <div style={{ fontSize: 11, color: C.dim, padding: "5px 0" }}>―</div>}
                          </div>
                        ))}
                      </div>
                    </div>

                    {isClassified && (
                      <button onClick={runClassify} disabled={classifying} style={{
                        padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8,
                        color: C.dim, fontSize: 11.5, cursor: classifying ? "default" : "pointer", fontFamily: "inherit",
                      }}>{classifying ? "⟳ 再分類中..." : "🔄 AI分類を更新（新しい銘柄を追加したとき）"}</button>
                    )}
                    {classifyErr && <div style={{ fontSize: 11.5, color: C.neg, marginTop: 10 }}>⚠ {classifyErr}</div>}
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ── 株式探索 ── */}
        {tab === "stock" && (
          <div>
            {/* 条件入力エリア */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>📡 株式探索条件</div>
                  <div style={{ fontSize: 10.5, color: C.dim, marginTop: 2 }}>テーマ・選定基準を自由に編集して探索できます</div>
                </div>
                <button onClick={runStockSearch} disabled={stockStatus === "loading"} style={{
                  padding: "9px 20px", borderRadius: 9, border: "none",
                  background: stockStatus === "loading" ? C.border : C.accent,
                  color: "#fff", fontSize: 13, fontWeight: 700, cursor: stockStatus === "loading" ? "default" : "pointer", fontFamily: "inherit",
                }}>
                  {stockStatus === "loading" ? "⟳ 調査中..." : stockResults.length > 0 ? "🔄 再調査" : "🔍 探索開始"}
                </button>
              </div>
              <textarea value={stockQuery} onChange={(e) => setStockQuery(e.target.value)}
                rows={8} style={{ width: "100%", padding: "10px 12px", background: "var(--input-bg)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 12, fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", lineHeight: 1.7 }} />
              <div style={{ fontSize: 10, color: C.dim, marginTop: 6 }}>
                ⚠ 本機能はAIによる調査・推定です。一次情報の正確性は必ずご自身でご確認ください。投資判断は自己責任でお願いします。
              </div>
            </div>

            {/* エラー */}
            {stockError && <div style={{ fontSize: 12.5, color: C.neg, padding: "12px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, marginBottom: 16 }}>⚠ {stockError}</div>}

            {/* ローディング */}
            {stockStatus === "loading" && (
              <div style={{ textAlign: "center", padding: "48px 0", color: C.dim, lineHeight: 2 }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
                <div style={{ fontSize: 13 }}>AIが日本の上場企業を調査中です<br />決算短信・IR資料・中計を確認しています<br /><span style={{ fontSize: 11 }}>1〜2分かかる場合があります</span></div>
              </div>
            )}

            {/* 前回結果ヘッダー */}
            {stockResults.length > 0 && stockStatus !== "loading" && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>成長期待株 ランキング TOP{stockResults.length}</div>
                <div style={{ fontSize: 10.5, color: C.dim }}>{stockUpdatedAt ? stockUpdatedAt.toLocaleString("ja-JP") + " 調査" : ""}</div>
              </div>
            )}

            {/* 結果カード */}
            {stockResults.length > 0 && stockStatus !== "loading" && stockResults.map((s, i) => {
              const expanded = stockExpanded[i];
              const scores = [
                { label: "成長性", val: s.growth, max: 20, color: C.accent },
                { label: "割安性", val: s.val, max: 20, color: "#10B981" },
                { label: "フィジカルAI", val: s.ai, max: 20, color: "#8B5CF6" },
                { label: "優位性", val: s.comp, max: 20, color: "#F59E0B" },
                { label: "リスク耐性", val: s.risk, max: 20, color: "#64748B" },
              ];
              return (
                <div key={i} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 12 }}>
                  {/* ヘッダー */}
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: i < 3 ? ["#F59E0B", "var(--muted)", "#CD7F32"][i] : "var(--surface2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
                      {s.rank || i + 1}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.text }}>{s.name} <span style={{ fontSize: 12, color: C.dim, fontWeight: 400 }}>（{s.code}）</span></div>
                      <div style={{ fontSize: 11.5, color: C.muted, marginTop: 2 }}>{s.overview}</div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 10, color: C.dim }}>総合スコア</div>
                      <div style={{ fontSize: 26, fontWeight: 800, color: (s.total || 0) >= 80 ? C.pos : (s.total || 0) >= 65 ? C.accent : C.muted, fontVariantNumeric: "tabular-nums" }}>{s.total}</div>
                      <div style={{ fontSize: 9.5, color: C.dim }}>/ 100</div>
                    </div>
                  </div>

                  {/* スコアバー */}
                  <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                    {scores.map((sc, j) => (
                      <div key={j} style={{ flex: "1 1 80px", minWidth: 70 }}>
                        <div style={{ fontSize: 9.5, color: C.dim, marginBottom: 3 }}>{sc.label}</div>
                        <div style={{ height: 5, background: "var(--surface2)", borderRadius: 3, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${((sc.val || 0) / sc.max) * 100}%`, background: sc.color, borderRadius: 3 }} />
                        </div>
                        <div style={{ fontSize: 10.5, fontWeight: 700, color: sc.color, marginTop: 2, textAlign: "right" }}>{sc.val}/{sc.max}</div>
                      </div>
                    ))}
                  </div>

                  {/* 投資妙味コメント（常時表示） */}
                  <div style={{ padding: "9px 12px", background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 8, fontSize: 12, color: C.text, marginBottom: 10, lineHeight: 1.6 }}>
                    💡 {s.comment}
                  </div>

                  {/* 展開ボタン */}
                  <button onClick={() => setStockExpanded((prev) => ({ ...prev, [i]: !prev[i] }))} style={{ width: "100%", padding: "6px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 7, color: C.muted, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>
                    {expanded ? "▲ 詳細を閉じる" : "▼ 詳細を見る（フィジカルAI接点・決算・シナリオ・リスク）"}
                  </button>

                  {/* 詳細 */}
                  {expanded && (
                    <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                      {[
                        { label: "🤖 フィジカルAI需要との接点", value: s.connection, color: "#8B5CF6" },
                        { label: "📊 直近決算のポイント", value: s.earnings, color: C.accent },
                        { label: "📈 今後2〜3年の成長シナリオ", value: s.scenario, color: C.pos },
                        { label: "💴 割安性の評価", value: s.valuation, color: "#F59E0B" },
                        { label: "🛡 競争優位性", value: s.advantage, color: "#10B981" },
                        { label: "⚠ 主なリスク", value: s.risks, color: C.neg },
                      ].map(({ label, value, color }, j) => value ? (
                        <div key={j}>
                          <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 3 }}>{label}</div>
                          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.7 }}>{value}</div>
                        </div>
                      ) : null)}
                    </div>
                  )}
                </div>
              );
            })}

            {stockResults.length === 0 && stockStatus !== "loading" && (
              <div style={{ textAlign: "center", color: C.dim, padding: "48px 20px", lineHeight: 1.8, fontSize: 13 }}>
                探索条件を確認して「🔍 探索開始」を押してください<br />
                <span style={{ fontSize: 11 }}>AIが一次情報をもとに日本の成長期待株を調査・ランキングします</span>
              </div>
            )}
          </div>
        )}

        {/* ── 不動産 ── */}
        {tab === "realestate" && (
          <div>
            <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 20, lineHeight: 1.7 }}>
              土地は査定額を手入力、建物は新築時の建築費と築年数から自動計算します（木造耐用年数22年・最低残存10%）。
            </div>

            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 16 }}>🏠 自宅 不動産情報</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  { key: "land", label: "土地評価額（査定額・円）", placeholder: "例: 30000000", hint: "固定資産税評価額 ÷ 0.7 や路線価×面積でもOK" },
                  { key: "buildCost", label: "建築費・取得価格（新築時・円）", placeholder: "例: 20000000", hint: "購入時の建物価格。不明な場合は概算でOK" },
                  { key: "builtYear", label: "建築年（西暦）", placeholder: "例: 2005", hint: `築${reAge}年 → 残存価値率 ${(reDepRate * 100).toFixed(0)}%` },
                  { key: "note", label: "メモ（任意）", placeholder: "例: 茅ヶ崎市○○町、4LDK 120㎡" },
                ].map(({ key, label, placeholder, hint }) => (
                  <div key={key}>
                    <div style={{ fontSize: 12, color: C.text, marginBottom: 5 }}>{label}</div>
                    <input
                      type={key === "note" ? "text" : "number"}
                      placeholder={placeholder}
                      value={realestate[key]}
                      onChange={(e) => setRealestate((prev) => ({ ...prev, [key]: e.target.value }))}
                      style={{ width: "100%", padding: "9px 12px", background: "var(--input-bg)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box" }}
                    />
                    {hint && <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>{hint}</div>}
                  </div>
                ))}
              </div>
            </div>

            {/* 計算結果 */}
            {hasRealestate && (
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.muted, marginBottom: 14 }}>📊 評価額の内訳</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "土地評価額", value: reLand, sub: "手入力値", color: C.text },
                    { label: `建物評価額（築${reAge}年・残存${(reDepRate * 100).toFixed(0)}%）`, value: reBuildValue, sub: `${fmt(reBuildCost)} × ${(reDepRate * 100).toFixed(0)}%`, color: C.text },
                  ].map((row, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.bg}`, fontSize: 13 }}>
                      <span style={{ color: C.muted }}>{row.label}</span>
                      <span style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: row.color }}>{fmt(row.value)}</div>
                        <div style={{ fontSize: 10, color: C.dim }}>{row.sub}</div>
                      </span>
                    </div>
                  ))}
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.border}`, fontSize: 14 }}>
                    <span style={{ fontWeight: 700, color: C.text }}>不動産合計</span>
                    <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontSize: 18 }}>{fmt(reTotal)}</span>
                  </div>
                  {totalLoan > 0 && (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", fontSize: 13 }}>
                        <span style={{ color: C.neg }}>住宅ローン残高（負債）</span>
                        <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: C.neg }}>−{fmt(totalLoan)}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", background: reNet >= 0 ? "rgba(16,185,129,0.06)" : "rgba(248,113,113,0.06)", borderRadius: 10, paddingLeft: 12, paddingRight: 12, marginTop: 4 }}>
                        <span style={{ fontWeight: 700, color: C.text, fontSize: 14 }}>不動産ネット</span>
                        <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", fontSize: 20, color: reNet >= 0 ? C.pos : C.neg }}>{fmt(reNet)}</span>
                      </div>
                      <div style={{ fontSize: 10, color: C.dim, lineHeight: 1.6 }}>不動産ネット＝不動産評価額 − 住宅ローン残高。この物件を売却してローンを完済したときの手残りの目安です。</div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div style={{ padding: 14, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, fontSize: 11.5, color: C.muted, lineHeight: 1.8 }}>
              💡 <strong style={{ color: C.text }}>査定額の参考方法</strong><br />
              <strong>土地：</strong>固定資産税評価額（毎年届く通知書）÷ 0.7 で市場価格の目安。または路線価（国税庁サイト）× 土地面積。<br />
              <strong>建築費：</strong>購入時の契約書や重要事項説明書に記載。不明な場合は延床面積 × 15〜20万円/㎡で概算。<br />
              <strong>参考：</strong>実際の売却価格はSUUMO等で近隣事例を確認するのが最もリアルです。
            </div>
          </div>
        )}

        {/* ── スクショ取込（4枠）── */}
        {tab === "upload" && (
          <div>
            <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 18, lineHeight: 1.7 }}>
              枠をタップして選択し、<strong style={{ color: C.text }}>{navigator.platform.toLowerCase().includes("mac") ? "⌘V" : "Ctrl+V"}</strong> でコピー済みのスクショを貼り付けられます（ファイル選択も可）。国内画面は特定／NISA成長／旧NISA／つみたてに自動で仕分けされます。
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(225px,1fr))", gap: 14 }}>
              {UPLOADS.map((u) => {
                const hs = holdings.filter((h) => h.src === u.id);
                return <UploadCard key={u.id} u={u} hs={hs} status={status[u.id]} error={errors[u.id]} onFile={processFile}
                  selected={selectedSlot === u.id} onSelect={() => setSelectedSlot(u.id)} C={C} />;
              })}
            </div>
            <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, fontSize: 11.5, color: C.dim, flexWrap: "wrap" }}>
              <span>海外株の為替は自動取得します。うまくいかない時のみ USD/JPY を手入力 →</span>
              <input
                type="number" inputMode="decimal" placeholder="例: 152.3" value={manualUsdJpy}
                onChange={(e) => setManualUsdJpy(e.target.value)}
                style={{ width: 90, padding: "5px 8px", background: "var(--surface2)", border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, fontSize: 12, fontFamily: "inherit" }}
              />
              {manualUsdJpy && <span style={{ color: C.accent }}>このレートを優先します</span>}
            </div>
            <div style={{ marginTop: 22, marginBottom: 10, fontSize: 12.5, color: C.dim, lineHeight: 1.7 }}>
              NISAの年間枠を自動計算するには、SBI証券の<strong style={{ color: C.text }}>取引履歴CSV</strong>（または画面スクショ）を取り込んでください。
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(225px,1fr))", gap: 14 }}>
              <TxUploadCard count={transactions.length} status={status.tx} error={errors.tx} onFile={processTxFile}
                selected={selectedSlot === "tx"} onSelect={() => setSelectedSlot("tx")} C={C} />
            </div>
            <div style={{ marginTop: 22, marginBottom: 10, fontSize: 12.5, color: C.dim, lineHeight: 1.7 }}>
              暗号資産の損益を出すには、Coincheckの<strong style={{ color: C.text }}>購入履歴</strong>を取り込んでください（2枚に分かれてもOK、追記でマージします）。
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(225px,1fr))", gap: 14 }}>
              <CryptoBuyUploadCard count={cryptoBuys.length} status={status.cryptobuy} error={errors.cryptobuy} onFile={processCryptoBuyFile}
                selected={selectedSlot === "cryptobuy"} onSelect={() => setSelectedSlot("cryptobuy")} C={C} />
            </div>
            <div style={{ marginTop: 22, padding: 15, background: "rgba(245,158,11,0.09)", border: "1px solid rgba(245,158,11,0.25)", borderRadius: 12, fontSize: 12, color: C.text, lineHeight: 1.7, fontWeight: 600 }}>
              ⚠️ スクショは<u>すべての銘柄が1枚に収まるように</u>撮ってください。<span style={{ fontWeight: 400, color: C.muted }}>取込はその口座を毎回まるごと上書きするため、2枚に分けると後の1枚で前の銘柄が消えます。銘柄が多くて入りきらない場合は、ブラウザの表示を縮小（ズームアウト）してから撮影するか、ご相談ください。</span>
            </div>
            <div style={{ marginTop: 14, padding: 15, background: "rgba(59,130,246,0.07)", border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12, fontSize: 12, color: C.muted, lineHeight: 1.85 }}>
              💡 <strong style={{ color: C.text }}>使い方のヒント</strong><br />
              SBI国内：口座管理 → 保有証券(ポートフォリオ全体)を1枚でスクショ<br />
              SBI海外：外国株式の保有画面を1枚でスクショ<br />
              PayPay証券：ポートフォリオ画面をスクショ<br />
              Coincheck：保有資産（総資産）の画面をスクショ<br />
              住宅ローン：銀行のネットバンキング → 残高照会（ローン一覧）をスクショ<br />
              住信SBI銀行：残高トップ画面をスクショ<br />
              取引履歴：口座管理 → 取引履歴 → CSVダウンロード（NISA枠・米国株円換算・利益確定の集計用）
            </div>

            <div style={{ marginTop: 24, padding: 15, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, marginBottom: 6 }}>☁️ GitHub Gistで自動同期（おすすめ）</div>
              <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.8, marginBottom: 12 }}>
                Secret Gist（非公開）にデータを保存し、両方の端末から自動で読み書きします。コピペ不要になります。<br />
                <strong style={{ color: C.muted }}>初回手順：</strong>①PCで<code style={{ color: C.text }}>gist</code>権限付きトークンを入れて「接続」→ Secret Gistが作られIDが表示されます。②そのトークンとIDをスマホ側にも入れて「接続」。以降は自動同期です。
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <input ref={tokenInputRef} type="password" placeholder="GitHubトークン（gist権限）" value={gistToken}
                  onChange={(e) => setGistToken(e.target.value)}
                  style={{ padding: "8px 10px", background: "var(--surface2)", border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, fontSize: 12, fontFamily: "monospace" }} />
                <input ref={idInputRef} type="text" placeholder="Gist ID（2台目以降に入力。1台目は空でOK）" value={gistId}
                  onChange={(e) => setGistId(e.target.value)}
                  style={{ padding: "8px 10px", background: "var(--surface2)", border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, fontSize: 12, fontFamily: "monospace" }} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button onClick={connectGist} disabled={gistBusy} style={{ padding: "7px 16px", background: gistBusy ? C.border : C.accent, border: "none", borderRadius: 8, color: "#fff", fontSize: 12, fontWeight: 600, cursor: gistBusy ? "default" : "pointer", fontFamily: "inherit" }}>
                    {gistBusy ? "⟳ 処理中..." : (gistId.trim() ? "🔗 接続して読込" : "✨ 新規作成して接続")}
                  </button>
                  {gistRef.current.id && (
                    <>
                      <button onClick={() => navigator.clipboard?.writeText(gistRef.current.id)} style={{ padding: "7px 12px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>📋 Gist IDをコピー</button>
                      <button onClick={disconnectGist} style={{ padding: "7px 12px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.dim, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>解除</button>
                    </>
                  )}
                  {gistRef.current.token && gistRef.current.id && <span style={{ fontSize: 11, color: C.pos }}>● 同期オン</span>}
                </div>
                {gistMsg && <div style={{ fontSize: 11.5, color: gistMsg.ok ? C.pos : C.neg, lineHeight: 1.5 }}>{gistMsg.ok ? "✓ " : "⚠ "}{gistMsg.text}</div>}
              </div>
              <div style={{ fontSize: 10, color: C.dim, marginTop: 10, lineHeight: 1.6 }}>
                ※ トークンはこのアプリ内（あなたのClaudeアカウント領域）に各端末ローカル保存され、Gist以外には送信しません。Gistは必ず非公開（Secret）で作成します。トークンは<code>gist</code>スコープが必要です。
              </div>
            </div>

            <div style={{ marginTop: 16, padding: 15, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: C.text, marginBottom: 6 }}>📱 手動バックアップ（コピペ方式）</div>
              <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.8, marginBottom: 12 }}>
                Gistを使わない場合の手動の手段です。片方で書き出してコピー → もう片方で貼り付けて反映します。
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button onClick={exportBackup} style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>⬇ バックアップを書き出す</button>
                <button onClick={() => { setShowBackup(true); setBackupText(""); setImportMsg(null); }} style={{ padding: "7px 14px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>⬆ バックアップを読み込む</button>
              </div>
              {showBackup && (
                <div style={{ marginTop: 12 }}>
                  <textarea value={backupText} onChange={(e) => setBackupText(e.target.value)}
                    placeholder="ここにバックアップ文字列を貼り付けて「この内容を反映」を押してください"
                    style={{ width: "100%", height: 90, padding: 10, background: "var(--input-bg)", border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, fontSize: 11, fontFamily: "monospace", resize: "vertical", boxSizing: "border-box" }} />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                    <button onClick={() => { navigator.clipboard?.writeText(backupText); }} style={{ padding: "6px 12px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 7, color: C.muted, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>📋 コピー</button>
                    <button onClick={importBackup} style={{ padding: "6px 12px", background: C.accent, border: "none", borderRadius: 7, color: "#fff", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>この内容を反映</button>
                    <button onClick={() => setShowBackup(false)} style={{ padding: "6px 12px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 7, color: C.dim, fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>閉じる</button>
                  </div>
                  {importMsg && <div style={{ fontSize: 11.5, marginTop: 8, color: importMsg.ok ? C.pos : C.neg }}>{importMsg.ok ? "✓ " : "⚠ "}{importMsg.text}</div>}
                </div>
              )}
            </div>

            {holdings.length > 0 && (
              <button onClick={reset} style={{ marginTop: 20, padding: "8px 15px", background: "transparent", border: `1px solid ${C.border}`, borderRadius: 8, color: C.dim, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>🗑 データをリセット</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TxUploadCard({ count, status, error, onFile, selected, onSelect, C }) {
  const inputRef = useRef();
  const [drag, setDrag] = useState(false);
  return (
    <div onClick={onSelect} style={{
      background: selected ? "rgba(139,92,246,0.08)" : C.surface,
      border: `1.5px solid ${selected ? "#8B5CF6" : (status === "done" ? "#8B5CF655" : C.border)}`,
      borderRadius: 14, padding: 16, cursor: "pointer", transition: "all 0.15s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#8B5CF6" }} />
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>取引履歴（NISA枠）</span>
        {selected && <span style={{ fontSize: 10, color: "#8B5CF6", marginLeft: "auto", fontWeight: 600 }}>貼り付け待ち</span>}
        {!selected && status === "done" && <span style={{ fontSize: 10.5, color: "#8B5CF6", marginLeft: "auto" }}>✓ 取込済</span>}
      </div>
      <div
        onClick={(e) => { e.stopPropagation(); onSelect(); inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
        style={{
          border: `1.5px dashed ${drag || selected ? "#8B5CF6" : "var(--surface2)"}`, borderRadius: 10, padding: "16px 12px",
          textAlign: "center", cursor: "pointer", fontSize: 12, lineHeight: 1.7,
          color: status === "loading" ? "#8B5CF6" : C.muted,
          background: drag ? "rgba(139,92,246,0.06)" : "transparent", transition: "all 0.15s",
        }}>
        <input ref={inputRef} type="file" accept=".csv,text/csv,image/*" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
        {status === "loading" ? "⟳ 解析中..." : selected ? <>📋 ここに貼り付け<br />（CSVはタップして選択）</> : <>📄 CSV / スクショを貼付/ドロップ<br />またはタップして選択</>}
      </div>
      {error && <div style={{ fontSize: 11, color: C.neg, marginTop: 8, lineHeight: 1.5 }}>⚠ {error}</div>}
      {count > 0 && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>NISA取引 {count}件を取込済</div>}
    </div>
  );
}

function CryptoBuyUploadCard({ count, status, error, onFile, selected, onSelect, C }) {
  const inputRef = useRef();
  const [drag, setDrag] = useState(false);
  return (
    <div onClick={onSelect} style={{
      background: selected ? "rgba(34,197,94,0.08)" : C.surface,
      border: `1.5px solid ${selected ? "#22C55E" : (status === "done" ? "#22C55E55" : C.border)}`,
      borderRadius: 14, padding: 16, cursor: "pointer", transition: "all 0.15s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#22C55E" }} />
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>Coincheck購入履歴</span>
        {selected && <span style={{ fontSize: 10, color: "#22C55E", marginLeft: "auto", fontWeight: 600 }}>貼り付け待ち</span>}
        {!selected && status === "done" && <span style={{ fontSize: 10.5, color: "#22C55E", marginLeft: "auto" }}>✓ 取込済</span>}
      </div>
      <div
        onClick={(e) => { e.stopPropagation(); onSelect(); inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}
        style={{
          border: `1.5px dashed ${drag || selected ? "#22C55E" : "var(--surface2)"}`, borderRadius: 10, padding: "16px 12px",
          textAlign: "center", cursor: "pointer", fontSize: 12, lineHeight: 1.7,
          color: status === "loading" ? "#22C55E" : C.muted,
          background: drag ? "rgba(34,197,94,0.06)" : "transparent", transition: "all 0.15s",
        }}>
        <input ref={inputRef} type="file" accept=".csv,text/csv,image/*" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0])} />
        {status === "loading" ? "⟳ 解析中..." : selected ? <>📋 ここに貼り付け<br />（複数枚OK・追記されます）</> : <>📄 購入履歴を貼付/ドロップ<br />（複数枚OK）</>}
      </div>
      {error && <div style={{ fontSize: 11, color: C.neg, marginTop: 8, lineHeight: 1.5 }}>⚠ {error}</div>}
      {count > 0 && <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>購入 {count}件を取込済</div>}
    </div>
  );
}

function NisaGauge({ label, used, limit, color, C }) {
  const pct = Math.min(100, (used / limit) * 100);
  const remain = limit - used;
  const over = remain < 0;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
        <span style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, color: C.dim, fontVariantNumeric: "tabular-nums" }}>
          {fmt(used)} / {fmt(limit)}
        </span>
      </div>
      <div style={{ height: 9, background: "var(--surface2)", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: over ? C.neg : color, borderRadius: 5, transition: "width 0.4s" }} />
      </div>
      <div style={{ fontSize: 11, marginTop: 4, color: over ? C.neg : C.muted, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {over ? `上限を ${fmt(-remain)} 超過` : `あと ${fmt(remain)} 投資可能`}
      </div>
    </div>
  );
}

function UploadCard({ u, hs, status, error, onFile, selected, onSelect, C }) {
  const inputRef = useRef();
  const [drag, setDrag] = useState(false);
  const sum = hs.reduce((s, h) => s + (h.market_value || 0), 0);
  return (
    <div onClick={onSelect} style={{
      background: selected ? "rgba(59,130,246,0.08)" : C.surface,
      border: `1.5px solid ${selected ? u.color : (status === "done" ? u.color + "55" : C.border)}`,
      borderRadius: 14, padding: 16, cursor: "pointer", transition: "all 0.15s",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: u.color }} />
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{u.label}</span>
        {selected && <span style={{ fontSize: 10, color: u.color, marginLeft: "auto", fontWeight: 600 }}>貼り付け待ち</span>}
        {!selected && status === "done" && <span style={{ fontSize: 10.5, color: u.color, marginLeft: "auto" }}>✓ 取込済</span>}
      </div>
      <div
        onClick={(e) => { e.stopPropagation(); onSelect(); inputRef.current?.click(); }}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0], u.id, u.label); }}
        style={{
          border: `1.5px dashed ${drag || selected ? u.color : "var(--surface2)"}`, borderRadius: 10, padding: "16px 12px",
          textAlign: "center", cursor: "pointer", fontSize: 12, lineHeight: 1.7,
          color: status === "loading" ? u.color : C.muted,
          background: drag ? "rgba(59,130,246,0.06)" : "transparent", transition: "all 0.15s",
        }}>
        <input ref={inputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onFile(e.target.files[0], u.id, u.label)} />
        {status === "loading" ? "⟳ 解析中..." : selected ? <>📋 ここに貼り付け<br />またはタップして選択</> : <>📷 スクショを貼付/ドロップ<br />またはタップして選択</>}
      </div>
      {error && <div style={{ fontSize: 11, color: C.neg, marginTop: 8, lineHeight: 1.5 }}>⚠ {error}</div>}
      {hs.length > 0 && (
        <div style={{ fontSize: 12, color: C.muted, marginTop: 10 }}>{hs.length}銘柄 / {fmt(sum)}<br /><span style={{ fontSize: 10, color: C.dim }}>{hs[0]?.updated}</span></div>
      )}
    </div>
  );
}
