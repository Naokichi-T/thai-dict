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
