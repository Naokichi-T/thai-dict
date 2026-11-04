// 検索履歴をブラウザ（localStorage）に保存・読み込みするための関数をまとめたファイル
// 履歴は使っている端末のブラウザの中だけに保存される（サーバーには送らない）
//
// 保存する形（新しいものが先頭）：
//   [
//     { query: "เขา", mode: "meaning" },
//     { query: "khao", mode: "reading" },
//     ...
//   ]
//   query：検索した言葉 ／ mode：検索モード（meaning：意味 / reading：読み）

// localStorage に保存するときの名前（ほかの保存データと同じく thai_dict_ で始める）
const STORAGE_KEY = "thai_dict_history";

// 履歴を残す最大の件数（これを超えたら古いものから捨てる）
export const MAX_HISTORY = 20;

/**
 * 履歴の一覧を localStorage に保存する
 * プライベートブラウズなどで保存できないときは、エラーにせず何もしない（検索は普通に使えるようにするため）
 * @param {{ query: string, mode: string }[]} list - 保存する履歴の一覧
 */
function saveHistory(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    // 保存できなくても検索には関係ないので、何もしない
  }
}

/**
 * localStorage から履歴の一覧を読み込んで返す
 * まだ何も保存されていないとき・中身が壊れているときは、空の配列を返す
 * ※ localStorage はブラウザにしかないので、onMount の中で呼ぶ
 * @returns {{ query: string, mode: string }[]}
 */
export function loadHistory() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    // まだ一度も保存していない
    if (!saved) return [];

    const list = JSON.parse(saved);
    // 配列でなければ壊れているとみなす
    if (!Array.isArray(list)) return [];

    // 形の正しいものだけを残す（query が文字で、mode が meaning か reading のもの）
    return list.filter((item) => typeof item?.query === "string" && (item.mode === "meaning" || item.mode === "reading")).slice(0, MAX_HISTORY);
  } catch (e) {
    // JSON として読めないなど
    return [];
  }
}

/**
 * 履歴に1件追加して、新しい一覧を返す（保存もする）
 * ・同じ言葉＋同じモードがすでにあれば、古いほうを消して先頭に持ってくる
 * ・MAX_HISTORY 件を超えたら、いちばん古いもの（末尾）を捨てる
 * 例：addHistory([{ query: "A", mode: "meaning" }, { query: "B", mode: "meaning" }], "B", "meaning")
 *     → [{ query: "B", mode: "meaning" }, { query: "A", mode: "meaning" }]
 * @param {{ query: string, mode: string }[]} list - 今の履歴の一覧
 * @param {string} query - 検索した言葉（前後の空白は取り除いて渡す）
 * @param {string} mode - 検索モード（meaning / reading）
 * @returns {{ query: string, mode: string }[]}
 */
export function addHistory(list, query, mode) {
  // 空の言葉は保存しない
  if (!query) return list;

  // 同じ言葉＋同じモードのものを取り除く（先頭に入れ直すため）
  const others = list.filter((item) => !(item.query === query && item.mode === mode));

  // 先頭に追加して、最大件数までに切りそろえる
  const next = [{ query, mode }, ...others].slice(0, MAX_HISTORY);

  saveHistory(next);
  return next;
}

/**
 * 履歴から1件消して、新しい一覧を返す（保存もする）
 * @param {{ query: string, mode: string }[]} list - 今の履歴の一覧
 * @param {number} index - 消すものの位置（0 が先頭＝いちばん新しいもの）
 * @returns {{ query: string, mode: string }[]}
 */
export function removeHistory(list, index) {
  const next = list.filter((_, i) => i !== index);
  saveHistory(next);
  return next;
}

/**
 * 履歴をすべて消して、空の一覧を返す（保存もする）
 * @returns {{ query: string, mode: string }[]}
 */
export function clearHistory() {
  saveHistory([]);
  return [];
}
