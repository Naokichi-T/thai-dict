import { createClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public";

// Supabaseクライアントを作成
const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

// 1ページあたりの表示件数
const PAGE_SIZE = 50;

/**
 * 読み仮名を正規化する（JS側のスコアリング用）
 * ng→n、y→i、w→o の順に変換する
 * @param {string} q - 対象文字列
 */
function normalizeReading(q) {
  return q
    .replace(/ng/g, "n") // ng → n（2文字なので最初に処理）
    .replace(/y/g, "i") // y → i
    .replace(/w/g, "o"); // w → o
}

export async function GET({ url }) {
  // クエリパラメータを取得
  const q = url.searchParams.get("q")?.trim() ?? "";
  const tab = url.searchParams.get("tab") ?? "ptj";
  const mode = url.searchParams.get("mode") ?? "meaning"; // meaning / reading
  const lang = url.searchParams.get("lang") ?? "other"; // thai / japanese / other
  const page = parseInt(url.searchParams.get("page") ?? "1"); // ページ番号（1始まり）

  // 検索ワードが空のときは空配列を返す
  if (!q) {
    return Response.json({ results: [], count: 0 });
  }

  // タブに応じて検索処理を切り替え
  if (tab === "ptj") {
    return await searchPtj(q, mode, lang, page);
  }

  if (tab === "gotthai") {
    return await searchGotthai(q, mode, lang, page);
  }

  if (tab === "nabeta") {
    return await searchNabeta(q, mode, lang, page);
  }

  if (tab === "thai") {
    return await searchThaiWords(q, mode, lang, page);
  }

  // 未実装のタブは空配列を返す
  return Response.json({ results: [], count: 0 });
}

/**
 * プログレッシブ辞典（ptj_words + ptj_sub）を検索する
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {string} lang - 入力言語（thai / japanese / other）
 * @param {number} page - ページ番号
 */
async function searchPtj(q, mode, lang, page) {
  let wordsData, wordsError, subData, subError;

  if (mode === "reading") {
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する
    ({ data: wordsData, error: wordsError } = await supabase.rpc("search_ptj_words_by_reading", { q }));
    ({ data: subData, error: subError } = await supabase.rpc("search_ptj_sub_by_reading", { q }));
  } else {
    // 意味モード：カラムを決めてSupabase側でフィルタリングする
    const column = lang === "thai" ? "keyword" : "meaning";

    ({ data: wordsData, error: wordsError } = await supabase
      .from("ptj_words")
      .select("id, no, keyword, reading, meaning, frequency, reading_normalized, reading_normalized_arr")
      .ilike(column, `%${q}%`)
      .order("no", { ascending: true }));

    ({ data: subData, error: subError } = await supabase
      .from("ptj_sub")
      .select("id, no, keyword, reading, meaning, parent_keyword, frequency, type, reading_normalized, reading_normalized_arr")
      .ilike(column, `%${q}%`)
      .order("no", { ascending: true }));
  }

  if (wordsError) return Response.json({ error: wordsError.message }, { status: 500 });
  if (subError) return Response.json({ error: subError.message }, { status: 500 });

  /**
   * スコアをつける関数
   * 読みモード：DB側の reading_normalized を正規化して q と比較する
   *   6 / 4: 完全一致（正規化なし）
   *   5 / 3: 前方一致（正規化なし）
   *   4 / 2: 部分一致（正規化なし）
   *   3 / 1: 完全一致（正規化後）
   *   2 / 0: 前方一致（正規化後）
   *   1 / -1: 部分一致（正規化後）
   *   null: どれにも一致しない → 除外
   * 意味モード：
   *   4 / 3: keywordの完全一致
   *   2 / 1: keywordの部分一致
   *   0 / -1: meaningの部分一致
   *  -2: type=exampleかつfrequency=0（ptj_sub、意味モードのみ）
   */
  function calcScore(item) {
    const isWords = item.source === "ptj_words";

    if (mode === "reading") {
      // type=exampleかつfrequency=0は最低優先度（読みモードでも同様）
      if (!isWords && item.type === "example" && item.frequency === 0) return -2;

      const r = item.reading_normalized ?? "";
      const rNorm = normalizeReading(r);

      // 正規化なしで完全一致・前方一致・部分一致 → 高スコア
      if (r === q) return isWords ? 6 : 4;
      if (r.startsWith(q)) return isWords ? 5 : 3;
      if (r.includes(q)) return isWords ? 4 : 2;
      // 正規化後に完全一致・前方一致・部分一致 → 低スコア
      if (rNorm === q) return isWords ? 3 : 1;
      if (rNorm.startsWith(q)) return isWords ? 2 : 0;
      if (rNorm.includes(q)) return isWords ? 1 : -1;
      return null; // どれにも一致しない → 除外
    }

    // 意味モードのときはtype=exampleかつfrequency=0は最低優先度
    if (!isWords && item.type === "example" && item.frequency === 0) return -2;

    // 意味モードのときはkeywordでスコアリングする
    if (item.keyword === q) return isWords ? 4 : 3;
    if (item.keyword.includes(q)) return isWords ? 2 : 1;
    return isWords ? 0 : -1;
  }

  // ptj_wordsとptj_subをまとめてスコアをつける
  const allResults = [...(wordsData ?? []).map((r) => ({ ...r, source: "ptj_words" })), ...(subData ?? []).map((r) => ({ ...r, source: "ptj_sub" }))]
    .map((r) => ({ ...r, score: calcScore(r) }))
    .filter((r) => r.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.no - b.no;
    });

  const count = allResults.length;
  const start = (page - 1) * PAGE_SIZE;
  const results = allResults.slice(start, start + PAGE_SIZE);

  return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
}

/**
 * ごったい（wordsテーブル）を検索する
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {string} lang - 入力言語（thai / japanese / other）
 * @param {number} page - ページ番号
 */
async function searchGotthai(q, mode, lang, page) {
  let data, fetchError;

  if (mode === "reading") {
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する
    ({ data, error: fetchError } = await supabase.rpc("search_words_by_reading", { q }));
  } else {
    // 意味モード：カラムを決めてSupabase側でフィルタリングする
    const column = lang === "thai" ? "thai" : "meaning";

    ({ data, error: fetchError } = await supabase
      .from("words")
      .select("id, no, url_no, url, thai, reading, meaning, frequency, formality, reading_normalized")
      .ilike(column, `%${q}%`)
      .order("url_no", { ascending: true }));
  }

  if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

  /**
   * スコアをつける関数
   * 読みモード：
   *   6: 完全一致（正規化なし）
   *   5: 前方一致（正規化なし）
   *   4: 部分一致（正規化なし）
   *   3: 完全一致（正規化後）
   *   2: 前方一致（正規化後）
   *   1: 部分一致（正規化後）
   *   null: どれにも一致しない → 除外
   * 意味モード：
   *   3: thaiの完全一致
   *   2: thaiの部分一致
   *   1: meaningの部分一致
   */
  function calcScore(item) {
    if (mode === "reading") {
      const r = item.reading_normalized ?? "";
      const rNorm = normalizeReading(r);

      if (r === q) return 6;
      if (r.startsWith(q)) return 5;
      if (r.includes(q)) return 4;
      if (rNorm === q) return 3;
      if (rNorm.startsWith(q)) return 2;
      if (rNorm.includes(q)) return 1;
      return null;
    }

    if (item.thai === q) return 3;
    if (item.thai.includes(q)) return 2;
    return 1;
  }

  const allResults = (data ?? [])
    .map((r) => ({ ...r, score: calcScore(r) }))
    .filter((r) => r.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.url_no - b.url_no;
    });

  const count = allResults.length;
  const start = (page - 1) * PAGE_SIZE;
  const results = allResults.slice(start, start + PAGE_SIZE);

  return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
}

/**
 * 鍋田辞書を検索する
 * タイ語・読みモード → Supabaseのnabeta_wordsを検索
 * 日本語／英語 → 本家サイトをスクレイピング
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {string} lang - 入力言語（thai / japanese / other）
 * @param {number} page - ページ番号
 */
async function searchNabeta(q, mode, lang, page) {
  // 日本語／英語の意味検索は本家サイトをスクレイピング
  if (mode === "meaning" && lang !== "thai") {
    return await scrapeNabeta(q, page);
  }

  if (mode === "reading") {
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する
    const { data, error: fetchError } = await supabase.rpc("search_nabeta_by_reading", { q });
    if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

    /**
     * スコアをつける関数
     * 6: 完全一致（正規化なし）
     * 5: 前方一致（正規化なし）
     * 4: 部分一致（正規化なし）
     * 3: 完全一致（正規化後）
     * 2: 前方一致（正規化後）
     * 1: 部分一致（正規化後）
     * null: どれにも一致しない → 除外
     */
    function calcScoreReading(item) {
      const r = item.reading_normalized ?? "";
      const rNorm = normalizeReading(r);

      if (r === q) return 6;
      if (r.startsWith(q)) return 5;
      if (r.includes(q)) return 4;
      if (rNorm === q) return 3;
      if (rNorm.startsWith(q)) return 2;
      if (rNorm.includes(q)) return 1;
      return null;
    }

    const allResults = (data ?? [])
      .map((r) => ({ ...r, score: calcScoreReading(r) }))
      .filter((r) => r.score !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.frequency !== a.frequency) return b.frequency - a.frequency;
        return a.no - b.no;
      });

    const count = allResults.length;
    const start = (page - 1) * PAGE_SIZE;
    const results = allResults.slice(start, start + PAGE_SIZE);

    return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
  }

  // タイ語検索（wordカラムの部分一致）
  const { data, error: fetchError } = await supabase.from("nabeta_words").select("id, no, word, meaning, reading, reading_normalized").ilike("word", `%${q}%`).order("no", { ascending: true });

  if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

  /**
   * スコアをつける関数
   * 3: wordの完全一致
   * 2: wordの前方一致
   * 1: wordの部分一致
   */
  function calcScore(item) {
    if (item.word === q) return 3;
    if (item.word.startsWith(q)) return 2;
    return 1;
  }

  const allResults = (data ?? [])
    .map((r) => ({ ...r, score: calcScore(r) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.no - b.no;
    });

  const count = allResults.length;
  const start = (page - 1) * PAGE_SIZE;
  const results = allResults.slice(start, start + PAGE_SIZE);

  return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
}

/**
 * 本家鍋田辞書サイトをスクレイピングして検索結果を返す
 * @param {string} q - 検索ワード
 * @param {number} page - ページ番号
 */
async function scrapeNabeta(q, page) {
  try {
    const searchUrl = `https://onlinedict.tk/onlinethai/?dd=0&fs=16&it=${encodeURIComponent(q)}&hk=100&rb=t&sl=bubun&jp=0&m=0`;
    const res = await fetch(searchUrl);
    const html = await res.text();

    const allResults = parseNabetaHtml(html, q);
    const count = allResults.length;
    const start = (page - 1) * PAGE_SIZE;
    const results = allResults.slice(start, start + PAGE_SIZE);

    return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
  } catch (e) {
    return Response.json({ error: "スクレイピングに失敗しました" }, { status: 500 });
  }
}

/**
 * 鍋田辞書のHTMLをパースして検索結果を返す
 * @param {string} html - 鍋田辞書のHTML
 * @param {string} q - 検索ワード
 */
function parseNabetaHtml(html, q) {
  const results = [];

  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const rowMatch of rowMatches) {
    const row = rowMatch[1];

    const cellMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length < 2) continue;

    const wordCell = cellMatches[0][1];
    const wordMatch = wordCell.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!wordMatch) continue;
    const word = wordMatch[1].replace(/<[^>]+>/g, "").trim();

    const meaningCell = cellMatches[1][1];
    const meaning = meaningCell
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .trim();

    if (!word || !meaning) continue;

    results.push({ word, meaning });
  }

  return results
    .map((r) => {
      const firstLine = r.meaning.split("\n")[0];
      let score = 1;
      if (r.word === q) score = 3;
      else if (r.word.startsWith(q)) score = 2;
      else if (firstLine.includes(q)) score = 1;
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * thai-language.com（thai_wordsテーブル）を検索する
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {string} lang - 入力言語（thai / japanese / other）
 * @param {number} page - ページ番号
 */
async function searchThaiWords(q, mode, lang, page) {
  let data, fetchError;

  if (mode === "reading") {
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する
    ({ data, error: fetchError } = await supabase.rpc("search_thai_words_by_reading", { q }));
  } else {
    // 意味モード：カラムを決めてSupabase側でフィルタリングする
    const column = lang === "thai" ? "word" : "meaning";

    ({ data, error: fetchError } = await supabase
      .from("thai_words")
      .select("id, no, word, reading, meaning, url, frequency, reading_normalized")
      .ilike(column, `%${q}%`)
      .order("no", { ascending: true }));
  }

  if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

  /**
   * スコアをつける関数
   * 読みモード：
   *   6: 完全一致（正規化なし）
   *   5: 前方一致（正規化なし）
   *   4: 部分一致（正規化なし）
   *   3: 完全一致（正規化後）
   *   2: 前方一致（正規化後）
   *   1: 部分一致（正規化後）
   *   null: どれにも一致しない → 除外
   * 意味モード：
   *   3: wordの完全一致
   *   2: wordの前方一致
   *   1: wordの部分一致
   */
  function calcScore(item) {
    if (mode === "reading") {
      const r = item.reading_normalized ?? "";
      const rNorm = normalizeReading(r);

      if (r === q) return 6;
      if (rNorm === q) return 5;
      if (r.startsWith(q)) return 4;
      if (rNorm.startsWith(q)) return 3;
      if (r.includes(q)) return 2;
      if (rNorm.includes(q)) return 1;
      return null;
    }

    if (item.word === q) return 3;
    if (item.word.startsWith(q)) return 2;
    return 1;
  }

  const allResults = (data ?? [])
    .map((r) => ({ ...r, score: calcScore(r) }))
    .filter((r) => r.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.no - b.no;
    });

  const count = allResults.length;
  const start = (page - 1) * PAGE_SIZE;
  const results = allResults.slice(start, start + PAGE_SIZE);

  return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
}
