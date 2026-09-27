import { createClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public";

// Supabaseクライアントを作成
const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

// 1ページあたりの表示件数
const PAGE_SIZE = 50;

// Supabaseから1回で取得する件数（Supabaseの上限が1000件なので、それに合わせる）
const BATCH_SIZE = 1000;

// 取得する件数の上限（ヒットが多すぎるときに取得を繰り返しすぎないための安全装置）
const MAX_ROWS = 10000;

/**
 * Supabaseの「1回で最大1000件」の制限を超えて、条件に合う行をまとめて取得する
 * 1000件ずつ取得してつなげ、1000件未満しか返ってこなかったら終わりにする
 * 取りすぎ防止のため、MAX_ROWS（10,000件）に達したらそこで止める
 * ※ 分けて取得するので、クエリには必ず並び順（.order() や SQL関数内の ORDER BY）が必要
 * @param {() => any} makeQuery - 呼ぶたびに新しいクエリを作って返す関数（.range() はこの中で付けない）
 * @returns {Promise<{ data: any[] | null, error: any }>} 取得した全行、またはエラー
 */
async function fetchAll(makeQuery) {
  let all = [];
  let from = 0;

  while (from < MAX_ROWS) {
    // from 件目から 1000件分を取得する（例：0〜999、1000〜1999、…）
    const { data, error } = await makeQuery().range(from, from + BATCH_SIZE - 1);

    // エラーが起きたら、そこで止めてエラーを返す
    if (error) return { data: null, error };

    // 取得した分をつなげる
    all = all.concat(data ?? []);

    // 1000件未満しか返ってこなければ、もう続きはないので終わり
    if (!data || data.length < BATCH_SIZE) break;

    // 次の1000件へ
    from += BATCH_SIZE;
  }

  return { data: all, error: null };
}

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

// 目次用の列（word_trgm など）と同じ置き換えの対応表
// トライグラムの目次では、声調記号などが「区切り」として扱われてしまうため、文字として扱われるギリシャ文字に置き換える
// ※ データベースの生成列の translate(word, U&'\0E47\0E48\0E49\0E4A\0E4B\0E4C\0E4E', 'αβγδεζη') と必ず同じにすること
const TRGM_REPLACE = {
  "\u0E47": "α", // ็ ไม้ไต่คู้
  "\u0E48": "β", // ่ ไม้เอก
  "\u0E49": "γ", // ้ ไม้โท
  "\u0E4A": "δ", // ๊ ไม้ตรี
  "\u0E4B": "ε", // ๋ ไม้จัตวา
  "\u0E4C": "ζ", // ์ การันต์
  "\u0E4E": "η", // ๎ ยามักการ
};

/**
 * 検索ワードを、目次用の列（word_trgm など）と同じ形に置き換えて返す
 * 例："ม้า" → "มγา"、"เล่น" → "เลβน"、"กิน" → "กิน"（置き換える文字がなければそのまま）
 * @param {string} text - 検索ワード
 */
function toTrgmText(text) {
  // 7文字（\u0E47〜\u0E4C と \u0E4E）を見つけたら、対応表のギリシャ文字に置き換える
  return text.replace(/[\u0E47-\u0E4C\u0E4E]/g, (ch) => TRGM_REPLACE[ch]);
}

/**
 * プログレッシブ辞典の meaning から「語」だけを取り出して配列で返す（日本語検索のスコアリング用）
 * 例："[名]❶性別，性 ❷性，性交，セックス" → ["性別", "性", "性", "性交", "セックス"]
 * 例："❶ 男性，男の人⇔หญิง[yǐŋ] 女性，女の人" → ["男性", "男の人"]
 * @param {string} meaning - ptj_words / ptj_sub の meaning
 */
function extractPtjTerms(meaning) {
  // meaning が null/undefined の場合は空配列を返す
  if (!meaning) return [];

  return (
    meaning
      // ① 改行と、語義番号（❶〜❿・①〜⑳）の直前で行に分ける
      //    （"❶性別，性 ❷性" のように1行に番号が並ぶ場合があるため。(?=...) は「直前」を表すので番号自体は消えない）
      .split(/\n|(?=[❶-❿①-⑳])/)
      // ② 「◆」で始まる行（用法の説明）は捨てる
      .filter((line) => !line.trim().startsWith("◆"))
      // ③ 各行から余計な部分を取り除いて、④ 語に分ける
      .flatMap((line) => {
        let text = line;

        // （…）(…) ＜…＞ を中身ごと取り除く（★説明・←語源・類別詞など）
        // （ ）の中に（ ）がある場合、1回では内側しか消えないので、変化がなくなるまで繰り返す
        let before;
        do {
          before = text;
          text = text
            // 全角・半角のかっこ（中にかっこを含まない一番内側のもの）
            .replace(/[（(][^（）()]*[）)]/g, "")
            // 類別詞の ＜…＞
            .replace(/＜[^＜＞]*＞/g, "");
        } while (text !== before);

        // ⇒（参照）・⇔（反対語）から行の終わりまでを取り除く
        text = text.replace(/[⇒⇔].*$/, "");

        // 品詞・分野などの印と、記号を取り除く
        text = text
          // [名] [修] などの品詞
          .replace(/\[[^\]]*\]/g, "")
          // ［คน＋修飾詞］などの用法の形
          .replace(/［[^］]*］/g, "")
          // 〔親族〕〔人体〕などの分野
          .replace(/〔[^〕]*〕/g, "")
          // 《指示代名詞》などの説明
          .replace(/《[^》]*》/g, "")
          // 品詞の区切り線「━」と、語義番号
          .replace(/[━❶-❿①-⑳]/g, "");

        // ④ 「，」（全角カンマ）と「；」（全角セミコロン）で語に分ける
        return text.split(/[，；]/);
      })
      // 前後の空白を取り除く
      .map((term) => term.trim())
      // 空になった語は捨てる
      .filter((term) => term !== "")
  );
}

/**
 * thai-language.com の meaning（JSON）から「語」だけを取り出して、小文字の配列で返す（英語検索のスコアリング用）
 * 例：[{"meaning": "gender; sex; form; sort; -hood"}] → ["gender", "sex", "form", "sort", "-hood"]
 * 例：[{"meaning": "[sexual; colloquial slang] a man's testicle (ball)"}] → ["a man's testicle"]
 * 例：[{"meaning": "to receive, get"}] → ["receive", "get"]（先頭の "to " は取る）
 * 例：[{"meaning": "to eat or drink"}] → ["eat", "drink"]（" or " でも分ける）
 * @param {string} meaning - thai_words の meaning（JSON形式の文字列）
 */
function extractThaiLangTerms(meaning) {
  // JSON を読む（壊れていたら空配列を返す）
  let entries;
  try {
    entries = JSON.parse(meaning ?? "[]");
  } catch {
    return [];
  }
  // 配列でなければ空配列を返す
  if (!Array.isArray(entries)) return [];

  return (
    entries
      // 品詞（category）ごとの意味を1つずつ処理して、語に分ける
      .flatMap((entry) => {
        let text = entry.meaning ?? "";

        // [...] (...) を中身ごと取り除く（[sexual; colloquial slang]、(ball) など）
        // かっこの中にかっこがある場合、1回では内側しか消えないので、変化がなくなるまで繰り返す
        let before;
        do {
          before = text;
          text = text
            // 角かっこ（中に角かっこを含まない一番内側のもの）
            .replace(/\[[^\[\]]*\]/g, "")
            // 丸かっこ（中に丸かっこを含まない一番内側のもの）
            .replace(/\([^()]*\)/g, "");
        } while (text !== before);

        // ダブルクォートを取り除く（"sexy" → sexy）
        text = text.replace(/"/g, "");

        // 「;」「,」と、前後に空白がある「 or 」で語に分ける
        // 例："to eat or drink" → ["to eat", "drink"]（このあと先頭の "to " を取って "eat" になる）
        // ※ \s は空白1文字。前後に空白があるものだけなので、"doctor" や "order" の中の or では分けない
        return text.split(/[;,]|\sor\s/);
      })
      .map((term) =>
        term
          // かっこを消したあとに残った余分な空白を1つにまとめる（"pick  up" → "pick up"）
          .replace(/\s+/g, " ")
          // 前後の空白を取り除く
          .trim()
          // 大文字小文字を区別しないよう小文字にする
          .toLowerCase()
          // 先頭の "to " を取る（"to receive" → "receive"）
          .replace(/^to /, ""),
      )
      // 空になった語は捨てる
      .filter((term) => term !== "")
  );
}

/**
 * PDIC の sample（「読み [英語の意味]」の形）から、英語の意味の部分だけを返す
 * 例："phra cao [God; Saviour]" → "God; Saviour]"
 * 最初の「[」より後ろを返す（読みの部分は含めない）。「[」がない行（読みだけ）は "" を返す
 * @param {string} sample - pdic_words の sample
 */
function getPdicEnglishPart(sample) {
  // sample が null/undefined の場合は "" を返す
  if (!sample) return "";
  // 最初の「[」の位置を探す
  const start = sample.indexOf("[");
  // 「[」がなければ英語の意味はないので "" を返す
  if (start === -1) return "";
  // 「[」の次の文字から最後までを返す
  return sample.slice(start + 1);
}

/**
 * PDIC の sample の英語の意味から「語」だけを取り出して、小文字の配列で返す（英語検索のスコアリング用）
 * 例："phra cao [God; Saviour; prefix for …]" → ["god", "saviour", "prefix for …"]
 * 例："tuu naa [Indian shortfin (or short-finned) eel]" → ["indian shortfin eel"]
 * @param {string} sample - pdic_words の sample
 */
function extractPdicTerms(sample) {
  // 英語の意味の部分だけを使う（読みの部分は使わない）
  let text = getPdicEnglishPart(sample);

  // 〔…〕（日本語の説明）と (…) を中身ごと取り除く
  // かっこの中にかっこがある場合、1回では内側しか消えないので、変化がなくなるまで繰り返す
  let before;
  do {
    before = text;
    text = text
      // 日本語の説明の〔…〕（中に〔〕を含まない一番内側のもの）
      .replace(/〔[^〔〕]*〕/g, "")
      // 丸かっこ（中に丸かっこを含まない一番内側のもの）
      .replace(/\([^()]*\)/g, "");
  } while (text !== before);

  // 残った「[」「]」を取り除く（閉じかっこや、閉じ忘れの「[」）
  text = text.replace(/[\[\]]/g, "");

  return (
    text
      // 「;」と「,」で語に分ける
      .split(/[;,]/)
      .map((term) =>
        term
          // かっこを消したあとに残った余分な空白を1つにまとめる
          .replace(/\s+/g, " ")
          // 前後の空白を取り除く
          .trim()
          // 大文字小文字を区別しないよう小文字にする
          .toLowerCase(),
      )
      // 空になった語は捨てる
      .filter((term) => term !== "")
  );
}

export async function GET({ url }) {
  // クエリパラメータを取得
  const qRaw = url.searchParams.get("q")?.trim() ?? "";
  // 読みモードのときはスペースを除去する（reading_normalizedがスペースなしのため）
  const mode = url.searchParams.get("mode") ?? "meaning";
  const q = mode === "reading" ? qRaw.replace(/ /g, "") : qRaw;
  const tab = url.searchParams.get("tab") ?? "ptj";
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

  if (tab === "pdic") {
    return await searchPdic(q, mode, lang, page);
  }

  if (tab === "thai") {
    return await searchThaiWords(q, mode, lang, page);
  }

  if (tab === "wiki") {
    return await searchWiktionary(q, mode, lang, page);
  }

  if (tab === "orst") {
    return await searchOrst(q, mode, lang, page);
  }

  if (tab === "translit") {
    return await searchTransliteration(q, mode, page);
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
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する（1000件を超えても全件取得）
    ({ data: wordsData, error: wordsError } = await fetchAll(() => supabase.rpc("search_ptj_words_by_reading", { q })));
    ({ data: subData, error: subError } = await fetchAll(() => supabase.rpc("search_ptj_sub_by_reading", { q })));
  } else {
    // 意味モード：カラムを決めてSupabase側でフィルタリングする（1000件を超えても全件取得）
    // タイ語入力：目次用の列 keyword_trgm を、同じ置き換えをした検索ワードで探す（声調記号があっても目次が効いて速い）
    // それ以外：meaning をそのまま探す（今まで通り）
    // ※ ptj_words と ptj_sub のどちらも同じ列名・同じ探し方
    const column = lang === "thai" ? "keyword_trgm" : "meaning";
    const pattern = lang === "thai" ? `%${toTrgmText(q)}%` : `%${q}%`;

    ({ data: wordsData, error: wordsError } = await fetchAll(() =>
      supabase.from("ptj_words").select("id, no, keyword, reading, meaning, frequency, reading_normalized, reading_normalized_arr").ilike(column, pattern).order("no", { ascending: true }),
    ));

    ({ data: subData, error: subError } = await fetchAll(() =>
      supabase
        .from("ptj_sub")
        .select("id, no, keyword, reading, meaning, parent_keyword, frequency, type, reading_normalized, reading_normalized_arr")
        .ilike(column, pattern)
        .order("no", { ascending: true }),
    ));
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
   * 意味モード（タイ語入力）：
   *   4 / 3: keywordの完全一致
   *   2 / 1: keywordの部分一致
   *   0 / -1: それ以外
   * 意味モード（日本語・英語入力）：extractPtjTerms で meaning から語を取り出して比べる
   *   4 / 3: どれかの語と完全一致（例：「性」で検索 → เพศ の「性」）
   *   2 / 1: どれかの語が検索ワードで始まる（例：「性」で検索 → คุณสมบัติ の「性質」）
   *   0 / -1: それ以外の部分一致（例：「性」で検索 → ครับ の説明文の「男性」）
   *  -2: type=exampleかつfrequency=0（ptj_sub、意味モードのみ）
   * ※ 「A / B」の A が ptj_words、B が ptj_sub のスコア
   */
  function calcScore(item) {
    const isWords = item.source === "ptj_words";

    if (mode === "reading") {
      // type=exampleかつfrequency=0は最低優先度（読みモードでも同様）
      if (!isWords && item.type === "example" && item.frequency === 0) return -2;

      const r = item.reading_normalized ?? "";
      const rNorm = normalizeReading(r);
      const arr = item.reading_normalized_arr ?? [];

      // 完全一致（正規化なし・正規化後・arr内）→ 最高スコア
      if (r === q || rNorm === q || arr.includes(q)) return isWords ? 6 : 4;
      // 前方一致（正規化なし・正規化後）
      if (r.startsWith(q) || rNorm.startsWith(q)) return isWords ? 5 : 3;
      // 部分一致（正規化なし・正規化後）
      if (r.includes(q) || rNorm.includes(q)) return isWords ? 4 : 2;
      // arr内 前方一致
      if (arr.some((a) => a.startsWith(q))) return isWords ? 3 : 1;
      // arr内 部分一致
      if (arr.some((a) => a.includes(q))) return isWords ? 2 : 0;
      return null; // どれにも一致しない → 除外
    }

    // 意味モードのときはtype=exampleかつfrequency=0は最低優先度
    if (!isWords && item.type === "example" && item.frequency === 0) return -2;

    // タイ語入力：keyword（見出し語）でスコアリングする（今まで通り）
    if (lang === "thai") {
      if (item.keyword === q) return isWords ? 4 : 3;
      if (item.keyword.includes(q)) return isWords ? 2 : 1;
      return isWords ? 0 : -1;
    }

    // 日本語・英語入力：meaning から語を取り出して比べる
    // 例："[名]❶性別，性 ❷性，性交，セックス" → ["性別", "性", "性", "性交", "セックス"]
    const terms = extractPtjTerms(item.meaning);

    // どれかの語と完全一致 → 最上位
    if (terms.includes(q)) return isWords ? 4 : 3;
    // どれかの語が検索ワードで始まる → 中間
    if (terms.some((term) => term.startsWith(q))) return isWords ? 2 : 1;
    // それ以外（説明文の中などに含まれているだけ）
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
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する（1000件を超えても全件取得）
    ({ data, error: fetchError } = await fetchAll(() => supabase.rpc("search_words_by_reading", { q })));
  } else {
    // 意味モード：カラムを決めてSupabase側でフィルタリングする（1000件を超えても全件取得）
    // タイ語入力：目次用の列 thai_trgm を、同じ置き換えをした検索ワードで探す（声調記号があっても目次が効いて速い）
    // それ以外：meaning をそのまま探す（今まで通り）
    const column = lang === "thai" ? "thai_trgm" : "meaning";
    const pattern = lang === "thai" ? `%${toTrgmText(q)}%` : `%${q}%`;

    ({ data, error: fetchError } = await fetchAll(() =>
      supabase.from("words").select("id, no, url_no, url, thai, reading, meaning, frequency, formality, reading_normalized").ilike(column, pattern).order("url_no", { ascending: true }),
    ));
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
   * 意味モード（タイ語入力）：
   *   3: thaiの完全一致
   *   2: thaiの部分一致
   *   1: それ以外
   * 意味モード（日本語・英語入力）：meaning のかっこ（注記・補足・読みがな）を取り除いてから、半角カンマで1語ずつに分けて比べる
   *   3: どれかの語と完全一致（例：「馬」で検索 → "馬<動物>,お母さん" の「馬」）
   *   2: どれかの語が検索ワードで始まる（例：「性」で検索 → "性器" の「性器」）
   *   1: それ以外の部分一致（例：「性」で検索 → "私[男性],僕" は、かっこを取ると「私」「僕」なので一致する語がない）
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

    // タイ語入力：thai（見出し語）で比べる（今まで通り）
    if (lang === "thai") {
      if (item.thai === q) return 3;
      if (item.thai.includes(q)) return 2;
      return 1;
    }

    // 日本語・英語入力：meaning からかっこを取り除いてから、半角カンマで区切って語のリストにする
    // 例："馬<動物>,お母さん,ママ<中国>" → "馬,お母さん,ママ" → ["馬", "お母さん", "ママ"]
    // ※ かっこを先に取り除くのは、"吐き出す[つば,タンなど]" のように、かっこの中にもカンマがあるため
    let text = item.meaning ?? "";

    // < > ＜ ＞（分類・注記）、[ ]（補足説明）、( ) （ ）（読みがな・補足）を中身ごと取り除く
    // かっこの中にかっこがある場合、1回では内側しか消えないので、変化がなくなるまで繰り返す
    let before;
    do {
      before = text;
      text = text
        // 山かっこ：<動物> <丁寧語> ＜…＞ など
        .replace(/[<＜][^<>＜＞]*[>＞]/g, "")
        // 角かっこ：[ガムなどを] [口を] など
        .replace(/\[[^\[\]]*\]/g, "")
        // 丸かっこ：(かに) （ホロスコープ） など
        .replace(/[(（][^()（）]*[)）]/g, "");
    } while (text !== before);

    // 半角カンマで分ける
    // ※「、」「，」は「２、３日前」のように語の中で使われているので区切りにしない
    const terms = text
      .split(",")
      // 前後の空白を取り除く
      .map((term) => term.trim())
      // 空になった語は捨てる
      .filter((term) => term !== "");

    // どれかの語と完全一致 → 最上位
    if (terms.includes(q)) return 3;
    // どれかの語が検索ワードで始まる → 中間
    if (terms.some((term) => term.startsWith(q))) return 2;
    // それ以外（語の途中に含まれているだけ）
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
 * 日本語／英語 → nabeta_jp_words.keywordを検索
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {string} lang - 入力言語（thai / japanese / other）
 * @param {number} page - ページ番号
 */
async function searchNabeta(q, mode, lang, page) {
  // 日本語／英語の意味検索はnabeta_jp_words.keywordを検索する
  if (mode === "meaning" && lang !== "thai") {
    // 1000件を超えても全件取得する（分けて取得するので、並び順として id 順を指定する）
    const { data, error: fetchError } = await fetchAll(() => supabase.from("nabeta_jp_words").select("id, keyword, content").ilike("keyword", `%${q}%`).order("id", { ascending: true }));

    if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

    /**
     * スコアをつける関数
     * 3: keywordの完全一致
     * 2: keywordの前方一致
     * 1: keywordの部分一致
     */
    function calcScoreMeaning(item) {
      if (item.keyword === q) return 3;
      if (item.keyword.startsWith(q)) return 2;
      return 1;
    }

    const allResults = (data ?? [])
      .map((r) => ({ ...r, source: "nabeta_jp", score: calcScoreMeaning(r) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return 0;
      });

    const count = allResults.length;
    const start = (page - 1) * PAGE_SIZE;
    const results = allResults.slice(start, start + PAGE_SIZE);

    return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
  }

  if (mode === "reading") {
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する（1000件を超えても全件取得）
    const { data, error: fetchError } = await fetchAll(() => supabase.rpc("search_nabeta_by_reading", { q }));
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

  // タイ語検索（1000件を超えても全件取得）
  // 目次用の列 word_trgm を、同じ置き換えをした検索ワードで探す（声調記号があっても目次が効いて速い）
  const { data, error: fetchError } = await fetchAll(() =>
    supabase
      .from("nabeta_words")
      .select("id, no, word, meaning, reading, reading_normalized")
      .ilike("word_trgm", `%${toTrgmText(q)}%`)
      .order("no", { ascending: true }),
  );

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
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する（1000件を超えても全件取得）
    ({ data, error: fetchError } = await fetchAll(() => supabase.rpc("search_thai_words_by_reading", { q })));
  } else {
    // 意味モード：カラムを決めてSupabase側でフィルタリングする（1000件を超えても全件取得）
    // タイ語入力：目次用の列 word_trgm を、同じ置き換えをした検索ワードで探す（声調記号があっても目次が効いて速い）
    // それ以外：meaning をそのまま探す（今まで通り）
    const column = lang === "thai" ? "word_trgm" : "meaning";
    const pattern = lang === "thai" ? `%${toTrgmText(q)}%` : `%${q}%`;

    ({ data, error: fetchError } = await fetchAll(() =>
      supabase.from("thai_words").select("id, no, word, reading, meaning, url, frequency, reading_normalized").ilike(column, pattern).order("no", { ascending: true }),
    ));
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
   * 意味モード（タイ語入力）：
   *   3: wordの完全一致
   *   2: wordの前方一致
   *   1: wordの部分一致
   * 意味モード（英語・日本語入力）：extractThaiLangTerms で meaning から語を取り出して比べる（大文字小文字は区別しない）
   *   3: どれかの語と完全一致（例：「sex」で検索 → เพศ の「sex」）
   *   2: どれかの語が検索ワードで始まる（例：「sex」で検索 → เซ็กส์ซี่ の「sexy」）
   *   1: それ以外の部分一致（例：「sex」で検索 → การบ้าน の「having sex」）
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

    // タイ語入力：word（見出し語）で比べる（今まで通り）
    if (lang === "thai") {
      if (item.word === q) return 3;
      if (item.word.startsWith(q)) return 2;
      return 1;
    }

    // 英語・日本語入力：meaning から語を取り出して、小文字どうしで比べる
    // 例："gender; sex; form; sort; -hood" → ["gender", "sex", "form", "sort", "-hood"]
    const qLower = q.toLowerCase();
    const terms = extractThaiLangTerms(item.meaning);

    // どれかの語と完全一致 → 最上位
    if (terms.includes(qLower)) return 3;
    // どれかの語が検索ワードで始まる → 中間
    if (terms.some((term) => term.startsWith(qLower))) return 2;
    // それ以外（説明文の途中に含まれているだけ）
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

/**
 * PDIC辞書（pdic_words + pdic_abbr）を検索する
 * タイ語入力 → 両テーブルを検索してマージ
 * 日本語入力 → pdic_ja_words.disp
 * 英語入力 → pdic_words.sample
 * 読みモード → pdic_words.reading_normalized（SQL関数）
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {string} lang - 入力言語（thai / japanese / other）
 * @param {number} page - ページ番号
 */
async function searchPdic(q, mode, lang, page) {
  let wordsData = [];
  let abbrData = [];

  if (mode === "reading") {
    // 読みモード：reading_normalized で RPC 関数を使って検索する（1000件を超えても全件取得）
    const { data, error } = await fetchAll(() => supabase.rpc("search_pdic_by_reading", { q }));
    if (error) return Response.json({ error: error.message }, { status: 500 });
    wordsData = data ?? [];
  } else if (lang === "thai") {
    // タイ語入力：pdic_words.word + pdic_abbr.word を両方検索（1000件を超えても全件取得）
    // 目次用の列 word_trgm を、同じ置き換えをした検索ワードで探す（声調記号があっても目次が効いて速い）
    const pattern = `%${toTrgmText(q)}%`;
    const [wordsRes, abbrRes] = await Promise.all([
      fetchAll(() => supabase.from("pdic_words").select("id, no, word, reading, meaning, sample, frequency").ilike("word_trgm", pattern).order("no", { ascending: true })),
      fetchAll(() => supabase.from("pdic_abbr").select("id, no, word, full_word").ilike("word_trgm", pattern).order("no", { ascending: true })),
    ]);
    if (wordsRes.error) return Response.json({ error: wordsRes.error.message }, { status: 500 });
    if (abbrRes.error) return Response.json({ error: abbrRes.error.message }, { status: 500 });
    wordsData = wordsRes.data ?? [];
    abbrData = abbrRes.data ?? [];
  } else if (lang === "japanese") {
    // 日本語入力：pdic_ja_words.disp を検索する（1000件を超えても全件取得）
    const { data, error } = await fetchAll(() => supabase.from("pdic_ja_words").select("id, no, disp, trans, phone").ilike("disp", `%${q}%`).order("no", { ascending: true }));
    if (error) return Response.json({ error: error.message }, { status: 500 });
    wordsData = data ?? [];
  } else {
    // 英語入力：pdic_words.sample を検索する（1000件を超えても全件取得）
    const { data, error } = await fetchAll(() => supabase.from("pdic_words").select("id, no, word, reading, meaning, sample, frequency").ilike("sample", `%${q}%`).order("no", { ascending: true }));
    if (error) return Response.json({ error: error.message }, { status: 500 });

    // sample は「読み [英語の意味]」の形なので、読みの部分にだけヒットした行を外す
    // 例：「book」で検索 → "book [tell; say; …]"（บอก の読みが book）は外す
    // 英語の意味の部分に検索ワードが入っている行だけを残す（大文字小文字は区別しない）
    const qLower = q.toLowerCase();
    wordsData = (data ?? []).filter((row) => getPdicEnglishPart(row.sample).toLowerCase().includes(qLower));
  }

  /**
   * スコアをつける関数
   * 意味モード（タイ語）:
   *   4: word の完全一致
   *   3: word の前方一致
   *   2: word の部分一致
   * 意味モード（日本語）:
   *   3: disp の完全一致
   *   2: disp の前方一致
   *   1: disp の部分一致
   * 意味モード（英語）：extractPdicTerms で sample の英語の意味から語を取り出して比べる（大文字小文字は区別しない）
   *   3: どれかの語と完全一致（例：「god」で検索 → พระเจ้า の「God」）
   *   2: どれかの語が検索ワードで始まる（例：「god」で検索 → โกดัง の「godown」）
   *   1: それ以外の部分一致（例：「god」で検索 → ตายแล้ว の「Oh my God！」）
   * 読みモード:
   *   3: reading の完全一致
   *   2: reading の前方一致
   *   1: reading の部分一致
   */
  function calcScore(item) {
    if (mode === "reading") {
      const r = item.reading_normalized ?? "";
      const rNorm = normalizeReading(r);
      const arr = item.reading_normalized_arr ?? [];

      // 完全一致（正規化なし・正規化後・arr内）→ 最高スコア
      if (r === q || rNorm === q || arr.includes(q)) return 4;
      // 前方一致
      if (r.startsWith(q) || rNorm.startsWith(q)) return 3;
      // 部分一致
      if (r.includes(q) || rNorm.includes(q)) return 2;
      // arr内 前方一致・部分一致
      if (arr.some((a) => a.startsWith(q))) return 1;
      if (arr.some((a) => a.includes(q))) return 0;
      return null;
    }
    if (lang === "thai") {
      if (item.word === q) return 4;
      if (item.word.startsWith(q)) return 3;
      return 2;
    }
    // 日本語入力：disp でスコアリングする（今まで通り）
    if (lang === "japanese") {
      if (item.disp === q) return 3;
      if (item.disp?.startsWith(q)) return 2;
      return 1;
    }

    // 英語入力：sample の英語の意味から語を取り出して、小文字どうしで比べる
    // 例："phra cao [God; Saviour; …]" → ["god", "saviour", …]
    const qLower = q.toLowerCase();
    const terms = extractPdicTerms(item.sample);

    // どれかの語と完全一致 → 最上位
    if (terms.includes(qLower)) return 3;
    // どれかの語が検索ワードで始まる → 中間
    if (terms.some((term) => term.startsWith(qLower))) return 2;
    // それ以外（説明文の途中に含まれているだけ）
    return 1;
  }

  // pdic_words・pdic_ja_words・pdic_abbr をマージしてスコアをつける
  const allResults = [
    ...wordsData.map((r) => ({ ...r, source: lang === "japanese" && mode !== "reading" ? "pdic_ja_words" : "pdic_words" })),
    ...abbrData.map((r) => ({ ...r, source: "pdic_abbr", frequency: 0 })),
  ]
    .map((r) => ({ ...r, score: calcScore(r) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // frequency 降順（0は最後）
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.no - b.no;
    });

  const count = allResults.length;
  const start = (page - 1) * PAGE_SIZE;
  const results = allResults.slice(start, start + PAGE_SIZE);

  return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
}

/**
 * Wiktionary（wiktionary_wordsテーブル）を検索する
 * 同じ見出し語（word）の行は1つにまとめ、品詞ごとの中身を entries に入れて返す
 * 読みモード → SQL関数 search_wiktionary_by_reading で reading_normalized を検索
 * タイ語入力 → word の部分一致
 * 英語入力   → meaning_en の部分一致
 * 日本語入力 → 日本語のデータがないので0件
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {string} lang - 入力言語（thai / japanese / other）
 * @param {number} page - ページ番号
 */
async function searchWiktionary(q, mode, lang, page) {
  // 日本語入力の意味検索は対象データがないので0件を返す
  if (mode === "meaning" && lang === "japanese") {
    return Response.json({ results: [], count: 0, page, totalPages: 1 });
  }

  let data, fetchError;

  if (mode === "reading") {
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する（1000件を超えても全件取得）
    ({ data, error: fetchError } = await fetchAll(() => supabase.rpc("search_wiktionary_by_reading", { q })));
  } else {
    // 意味モード：タイ語入力なら word_trgm、英語入力なら meaning_en を検索する（1000件を超えても全件取得）
    // タイ語入力：目次用の列 word_trgm を、同じ置き換えをした検索ワードで探す（声調記号があっても目次が効いて速い）
    // 英語入力：meaning_en をそのまま探す（今まで通り）
    const column = lang === "thai" ? "word_trgm" : "meaning_en";
    const pattern = lang === "thai" ? `%${toTrgmText(q)}%` : `%${q}%`;

    ({ data, error: fetchError } = await fetchAll(() =>
      supabase.from("wiktionary_words").select("id, word, reading_paiboon, pos_title, pos, meaning, meaning_en, frequency, reading_normalized").ilike(column, pattern).order("id", { ascending: true }),
    ));
  }

  if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

  // 同じ見出し語（word）の行を1つにまとめる
  // Map は追加した順番を保つので、id 順に並んだまま entries が作られる
  const groups = new Map();

  for (const row of data ?? []) {
    // その見出し語が初めて出てきたら、まとめ用のオブジェクトを作る
    if (!groups.has(row.word)) {
      groups.set(row.word, {
        word: row.word,
        reading_paiboon: row.reading_paiboon,
        frequency: row.frequency ?? 0,
        reading_normalized: row.reading_normalized,
        firstId: row.id,
        entries: [],
      });
    }

    const group = groups.get(row.word);

    // 最初の行の読みが空だった場合は、後の行の読みで埋める
    if (!group.reading_paiboon && row.reading_paiboon) group.reading_paiboon = row.reading_paiboon;
    if (!group.reading_normalized && row.reading_normalized) group.reading_normalized = row.reading_normalized;

    // frequency は行の中で一番大きい値、firstId は一番小さい id にする
    group.frequency = Math.max(group.frequency, row.frequency ?? 0);
    group.firstId = Math.min(group.firstId, row.id);

    // 品詞ごとの中身を追加する
    group.entries.push({
      pos_title: row.pos_title,
      pos: row.pos,
      meaning: row.meaning,
      meaning_en: row.meaning_en,
    });
  }

  /**
   * まとめた見出し語1つにスコアをつける関数
   * 読みモード：
   *   6: 完全一致（正規化なし）
   *   5: 完全一致（正規化後）
   *   4: 前方一致（正規化なし）
   *   3: 前方一致（正規化後）
   *   2: 部分一致（正規化なし）
   *   1: 部分一致（正規化後）
   *   null: どれにも一致しない → 除外
   * 意味モード（タイ語入力）：
   *   3: word の完全一致
   *   2: word の前方一致
   *   1: word の部分一致
   * 意味モード（英語入力）：meaning_en をカンマで1語ずつに分けて比べる（大文字小文字は区別しない）
   *   3: どれかの語と完全一致
   *   2: どれかの語と前方一致
   *   1: それ以外の部分一致
   */
  function calcScore(group) {
    if (mode === "reading") {
      const r = group.reading_normalized ?? "";
      const rNorm = normalizeReading(r);

      if (r === q) return 6;
      if (rNorm === q) return 5;
      if (r.startsWith(q)) return 4;
      if (rNorm.startsWith(q)) return 3;
      if (r.includes(q)) return 2;
      if (rNorm.includes(q)) return 1;
      return null;
    }

    if (lang === "thai") {
      if (group.word === q) return 3;
      if (group.word.startsWith(q)) return 2;
      return 1;
    }

    // 英語入力：全 entries の meaning_en をカンマで分けて、小文字の語のリストにする
    const qLower = q.toLowerCase();
    const terms = group.entries
      .flatMap((entry) => (entry.meaning_en ?? "").split(","))
      .map((term) => term.trim().toLowerCase())
      .filter((term) => term !== "");

    if (terms.includes(qLower)) return 3;
    if (terms.some((term) => term.startsWith(qLower))) return 2;
    return 1;
  }

  // スコアをつけて並び替える（スコア降順 → frequency 降順 → firstId 昇順）
  const allResults = [...groups.values()]
    .map((group) => ({ ...group, score: calcScore(group) }))
    .filter((group) => group.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.firstId - b.firstId;
    });

  // 件数は「見出し語の数」で数える
  const count = allResults.length;
  const start = (page - 1) * PAGE_SIZE;
  const results = allResults.slice(start, start + PAGE_SIZE);

  return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
}

/**
 * 王立学士院辞書（orst_wordsテーブル）を検索する
 * 同じ見出し語（word）の行は1つにまとめ、語義ごとの中身を senses に入れて返す
 * 読みモード       → SQL関数 search_orst_by_reading で reading_normalized を検索
 * タイ語入力       → word の部分一致
 * 日本語・英語入力 → タイ語の説明文しかないので0件
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {string} lang - 入力言語（thai / japanese / other）
 * @param {number} page - ページ番号
 */
async function searchOrst(q, mode, lang, page) {
  // 意味モードでタイ語以外の入力は対象データがないので0件を返す
  if (mode === "meaning" && lang !== "thai") {
    return Response.json({ results: [], count: 0, page, totalPages: 1 });
  }

  let data, fetchError;

  if (mode === "reading") {
    // 読みモード：DB側のnormalize_reading関数で正規化して検索する（1000件を超えても全件取得）
    ({ data, error: fetchError } = await fetchAll(() => supabase.rpc("search_orst_by_reading", { q })));
  } else {
    // 意味モード（タイ語入力）：部分一致で検索する（1000件を超えても全件取得）
    // 目次用の列 word_trgm を、同じ置き換えをした検索ワードで探す（声調記号があっても目次が効いて速い）
    ({ data, error: fetchError } = await fetchAll(() =>
      supabase
        .from("orst_words")
        .select("id, word, sense_label, sense_no, meaning, related_words, frequency, reading_normalized")
        .ilike("word_trgm", `%${toTrgmText(q)}%`)
        .order("id", { ascending: true }),
    ));
  }

  if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

  // 同じ見出し語（word）の行を1つにまとめる
  // Map は追加した順番を保つ
  const groups = new Map();

  for (const row of data ?? []) {
    // その見出し語が初めて出てきたら、まとめ用のオブジェクトを作る
    if (!groups.has(row.word)) {
      groups.set(row.word, {
        word: row.word,
        frequency: row.frequency ?? 0,
        reading_normalized: row.reading_normalized,
        firstId: row.id,
        senses: [],
      });
    }

    const group = groups.get(row.word);

    // 最初の行の読みが空だった場合は、後の行の読みで埋める
    if (!group.reading_normalized && row.reading_normalized) group.reading_normalized = row.reading_normalized;

    // frequency は行の中で一番大きい値、firstId は一番小さい id にする
    group.frequency = Math.max(group.frequency, row.frequency ?? 0);
    group.firstId = Math.min(group.firstId, row.id);

    // 語義ごとの中身を追加する
    group.senses.push({
      sense_label: row.sense_label,
      sense_no: row.sense_no,
      meaning: row.meaning,
      related_words: row.related_words,
    });
  }

  // 各見出し語の senses を sense_no の小さい順に並べる（เขา ๑ → เขา ๒ → …）
  for (const group of groups.values()) {
    group.senses.sort((a, b) => (a.sense_no ?? 0) - (b.sense_no ?? 0));
  }

  /**
   * まとめた見出し語1つにスコアをつける関数
   * 読みモード：
   *   6: 完全一致（正規化なし）
   *   5: 完全一致（正規化後）
   *   4: 前方一致（正規化なし）
   *   3: 前方一致（正規化後）
   *   2: 部分一致（正規化なし）
   *   1: 部分一致（正規化後）
   *   null: どれにも一致しない → 除外
   * 意味モード（タイ語入力）：
   *   3: word の完全一致
   *   2: word の前方一致
   *   1: word の部分一致
   */
  function calcScore(group) {
    if (mode === "reading") {
      const r = group.reading_normalized ?? "";
      const rNorm = normalizeReading(r);

      if (r === q) return 6;
      if (rNorm === q) return 5;
      if (r.startsWith(q)) return 4;
      if (rNorm.startsWith(q)) return 3;
      if (r.includes(q)) return 2;
      if (rNorm.includes(q)) return 1;
      return null;
    }

    if (group.word === q) return 3;
    if (group.word.startsWith(q)) return 2;
    return 1;
  }

  // スコアをつけて並び替える（スコア降順 → frequency 降順 → firstId 昇順）
  const allResults = [...groups.values()]
    .map((group) => ({ ...group, score: calcScore(group) }))
    .filter((group) => group.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.firstId - b.firstId;
    });

  // 件数は「見出し語の数」で数える
  const count = allResults.length;
  const start = (page - 1) * PAGE_SIZE;
  const results = allResults.slice(start, start + PAGE_SIZE);

  return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
}

/**
 * 王立学士院の音訳データ（orst_transliterationsテーブル）を検索する
 * 外来語（foreign_word）だけを検索対象にする（thai_word は検索しない）
 * 入力言語は問わない（英語・日本語・その他の言語すべて foreign_word を検索する）
 * 1行＝1件として返す（言語が違うと別の行なので、まとめ処理はしない）
 * 読みモード → 対象外なので0件
 * @param {string} q - 検索ワード
 * @param {string} mode - 検索モード（meaning / reading）
 * @param {number} page - ページ番号
 */
async function searchTransliteration(q, mode, page) {
  // 読みモードは対象外なので0件を返す
  if (mode === "reading") {
    return Response.json({ results: [], count: 0, page, totalPages: 1 });
  }

  // foreign_word を部分一致で検索する（ilike は大文字小文字を区別しない、1000件を超えても全件取得）
  const { data, error: fetchError } = await fetchAll(() =>
    supabase.from("orst_transliterations").select("id, pointer_id, sub_language_id, foreign_word, thai_word").ilike("foreign_word", `%${q}%`).order("id", { ascending: true }),
  );

  if (fetchError) return Response.json({ error: fetchError.message }, { status: 500 });

  // 比較用に検索ワードを小文字にしておく
  const qLower = q.toLowerCase();

  /**
   * スコアをつける関数（大文字小文字は区別しない）
   *   3: foreign_word の完全一致
   *   2: foreign_word の前方一致
   *   1: foreign_word の部分一致
   */
  function calcScore(item) {
    const foreign = (item.foreign_word ?? "").toLowerCase();

    if (foreign === qLower) return 3;
    if (foreign.startsWith(qLower)) return 2;
    return 1;
  }

  // スコアをつけて並び替える（スコア降順 → foreign_word が短い順 → id 昇順）
  const allResults = (data ?? [])
    .map((item) => ({ ...item, score: calcScore(item) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const lengthA = (a.foreign_word ?? "").length;
      const lengthB = (b.foreign_word ?? "").length;
      if (lengthA !== lengthB) return lengthA - lengthB;
      return a.id - b.id;
    });

  const count = allResults.length;
  const start = (page - 1) * PAGE_SIZE;
  const results = allResults.slice(start, start + PAGE_SIZE);

  return Response.json({ results, count, page, totalPages: Math.ceil(count / PAGE_SIZE) });
}
