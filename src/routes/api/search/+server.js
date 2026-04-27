import { createClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public";

// Supabaseクライアントを作成
const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

/**
 * GET /api/search
 * クエリパラメータ：
 *   q   : 検索ワード
 *   tab : 検索対象（ptj / gotthai / nabeta）
 */
// 1ページあたりの表示件数
const PAGE_SIZE = 50;

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

  // 未実装のタブは空配列を返す
  return Response.json({ results: [], count: 0 });
}

/**
 * プログレッシブ辞典（ptj_words + ptj_sub）を検索する
 * @param {string} q - 検索ワード
 */
async function searchPtj(q, mode, lang, page) {
  // 検索対象カラムを決定する
  // 読みモード → reading_normalized
  // 意味モード＋タイ語 → keyword
  // 意味モード＋日本語／英語 → meaning
  let column;
  if (mode === "reading") {
    column = "reading_normalized";
  } else if (lang === "thai") {
    column = "keyword";
  } else {
    column = "meaning";
  }

  // ptj_wordsを全件取得（limitなし）
  const { data: wordsData, error: wordsError } = await supabase.from("ptj_words").select("id, no, keyword, reading, meaning, frequency").ilike(column, `%${q}%`).order("no", { ascending: true });

  if (wordsError) {
    return Response.json({ error: wordsError.message }, { status: 500 });
  }

  // ptj_subを全件取得（limitなし）
  const { data: subData, error: subError } = await supabase
    .from("ptj_sub")
    .select("id, no, keyword, reading, meaning, parent_keyword, frequency, type")
    .ilike(column, `%${q}%`)
    .order("no", { ascending: true });

  if (subError) {
    return Response.json({ error: subError.message }, { status: 500 });
  }

  /**
   * スコアをつける関数
   * 4: keywordの完全一致（ptj_words）
   * 3: keywordの完全一致（ptj_sub）
   * 2: keywordの部分一致（ptj_words）
   * 1: keywordの部分一致（ptj_sub）
   * 0: meaningの部分一致（ptj_words）
   * -1: meaningの部分一致（ptj_sub）
   * -2: type=exampleかつfrequency=0（ptj_sub）
   */
  function calcScore(item, q) {
    const isWords = item.source === "ptj_words";

    // type=exampleかつfrequency=0は最低優先度
    if (!isWords && item.type === "example" && item.frequency === 0) return -2;

    if (item.keyword === q) return isWords ? 4 : 3;
    if (item.keyword.includes(q)) return isWords ? 2 : 1;
    return isWords ? 0 : -1;
  }

  // ptj_wordsとptj_subをまとめてスコア順に並び替え
  const allResults = [...wordsData.map((r) => ({ ...r, source: "ptj_words" })), ...subData.map((r) => ({ ...r, source: "ptj_sub" }))]
    .map((r) => ({ ...r, score: calcScore(r, q) }))
    .sort((a, b) => {
      // スコア降順 → frequency降順 → no昇順
      if (b.score !== a.score) return b.score - a.score;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.no - b.no;
    });

  // 全件数
  const count = allResults.length;

  // 指定ページの50件だけ切り出す
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
  // 検索対象カラムを決定する
  // 読みモード → reading_normalized
  // 意味モード＋タイ語 → thai
  // 意味モード＋日本語／英語 → meaning
  let column;
  if (mode === "reading") {
    column = "reading_normalized";
  } else if (lang === "thai") {
    column = "thai";
  } else {
    column = "meaning";
  }

  // wordsテーブルを全件取得（limitなし）
  const { data, error: fetchError } = await supabase
    .from("words")
    .select("id, no, url_no, url, thai, reading, meaning, frequency, formality")
    .ilike(column, `%${q}%`)
    .order("url_no", { ascending: true });

  if (fetchError) {
    return Response.json({ error: fetchError.message }, { status: 500 });
  }

  /**
   * スコアをつける関数
   * 3: thaiの完全一致
   * 2: thaiの部分一致
   * 1: meaningの部分一致
   */
  function calcScore(item, q) {
    if (item.thai === q) return 3;
    if (item.thai.includes(q)) return 2;
    return 1;
  }

  // スコア順に並び替え
  const allResults = data
    .map((r) => ({ ...r, score: calcScore(r, q) }))
    .sort((a, b) => {
      // スコア降順 → frequency降順 → url_no昇順
      if (b.score !== a.score) return b.score - a.score;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.url_no - b.url_no;
    });

  // 全件数
  const count = allResults.length;

  // 指定ページの件数だけ切り出す
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

  // タイ語検索 → wordカラムで検索
  const column = "word";

  if (mode === "reading") {
    // reading_normalizedカラムの部分一致検索
    const { data, error: fetchError } = await supabase
      .from("nabeta_words")
      .select("id, no, word, meaning, reading, reading_normalized, frequency")
      .ilike("reading_normalized", `%${q}%`)
      .order("no", { ascending: true })
      .limit(1000);

    if (fetchError) {
      return Response.json({ error: fetchError.message }, { status: 500 });
    }

    /**
     * スコアをつける関数
     * 3: reading_normalizedの完全一致
     * 2: reading_normalizedの前方一致
     * 1: reading_normalizedの部分一致
     */
    function calcScore(item, q) {
      if (item.reading_normalized === q) return 3;
      if (item.reading_normalized?.startsWith(q)) return 2;
      return 1;
    }

    const allResults = data
      .map((r) => ({ ...r, score: calcScore(r, q) }))
      .sort((a, b) => {
        // スコア降順 → frequency降順 → no昇順
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
  const { data, error: fetchError } = await supabase
    .from("nabeta_words")
    .select("id, no, word, meaning, reading, reading_normalized")
    .ilike(column, `%${q}%`)
    .order("no", { ascending: true })
    .limit(1000);

  if (fetchError) {
    return Response.json({ error: fetchError.message }, { status: 500 });
  }

  /**
   * スコアをつける関数
   * 3: reading_normalizedの完全一致
   * 2: reading_normalizedの前方一致
   * 1: reading_normalizedの部分一致
   */
  function calcScore(item, q) {
    if (item.reading_normalized === q) return 3;
    if (item.reading_normalized?.startsWith(q)) return 2;
    return 1;
  }

  const allResults = data
    .map((r) => ({ ...r, score: calcScore(r, q) }))
    .sort((a, b) => {
      // スコア降順 → frequency降順 → no昇順
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
    // 本家サイトに検索リクエストを送る
    const searchUrl = `https://onlinedict.tk/onlinethai/?dd=0&fs=16&it=${encodeURIComponent(q)}&hk=100&rb=t&sl=bubun&jp=0&m=0`;
    const res = await fetch(searchUrl);
    const html = await res.text();

    // HTMLをパースして結果を取り出す
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
 * nabeta-dictの parseRows と同じロジック＋スコアリング
 * @param {string} html - 鍋田辞書のHTML
 * @param {string} q - 検索ワード
 */
function parseNabetaHtml(html, q) {
  const results = [];

  // <table>の中の<tr>を全部取り出す
  const rowMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const rowMatch of rowMatches) {
    const row = rowMatch[1];

    // <td>を2つ取り出す（1つ目：単語、2つ目：訳語）
    const cellMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cellMatches.length < 2) continue;

    // 単語列：<a>タグの中のテキストを取り出す
    const wordCell = cellMatches[0][1];
    const wordMatch = wordCell.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!wordMatch) continue;
    const word = wordMatch[1].replace(/<[^>]+>/g, "").trim();

    // 訳語列：HTMLタグを除去してテキストだけにする
    const meaningCell = cellMatches[1][1];
    const meaning = meaningCell
      .replace(/<br\s*\/?>/gi, "\n") // <br>を改行に変換
      .replace(/<[^>]+>/g, "") // 残りのHTMLタグを除去
      .trim();

    if (!word || !meaning) continue;

    results.push({ word, meaning });
  }

  // スコアリングして並び替え
  return results
    .map((r) => {
      const firstLine = r.meaning.split("\n")[0];
      let score = 1;
      if (r.word === q)
        score = 4; // word完全一致
      else if (r.word.startsWith(q))
        score = 3; // word前方一致
      else if (firstLine.includes(q)) score = 2; // meaning先頭行にある
      return { ...r, score };
    })
    .sort((a, b) => b.score - a.score);
}
