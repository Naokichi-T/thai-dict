import { DEEPL_API_KEY } from "$env/static/private";

// 1回のリクエストで翻訳できる文の数の上限（大量に送られて無料枠を使い切られないための安全装置）
const MAX_TEXTS = 50;

// 1回のリクエストで翻訳できる合計文字数の上限（同上）
const MAX_TOTAL_CHARS = 5000;

// DeepL から返ってきたエラー番号ごとの、ユーザー向けメッセージ
const ERROR_MESSAGES = {
  // 456：今月の上限（無料プランは50万文字）を超えた
  456: "今月の翻訳の上限に達したため、しばらく翻訳できません。次の利用期間が始まると使えるようになります。",
  // 429：短時間にリクエストが多すぎる
  429: "翻訳が混み合っています。少し時間をおいてもう一度お試しください。",
  // 403：APIキーが間違っている・無効
  403: "翻訳の設定に問題があります（管理者向け：APIキーを確認してください）。",
};

// 上の表にないエラーのときのメッセージ
const DEFAULT_ERROR = "翻訳に失敗しました。もう一度お試しください。";

/**
 * タイ語の文の配列を、DeepL API で日本語に翻訳して返す
 * 受け取るもの：{ texts: ["タイ語の文1", "タイ語の文2", ...] }
 * 返すもの（成功）：{ translations: ["訳1", "訳2", ...] }（送った順番のまま）
 * 返すもの（失敗）：{ error: "ユーザー向けのメッセージ" }
 * @param {{ request: Request }} event - SvelteKit から渡されるリクエスト情報
 */
export async function POST({ request }) {
  // 送られてきたデータ（JSON）を読み取る
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "リクエストの形式が正しくありません。" }, { status: 400 });
  }

  const texts = body?.texts;

  // texts が「文字列の配列」で、1つ以上あるかをチェックする
  if (!Array.isArray(texts) || texts.length === 0 || texts.some((text) => typeof text !== "string")) {
    return Response.json({ error: "翻訳する文章がありません。" }, { status: 400 });
  }

  // 文の数・合計文字数が上限を超えていないかチェックする
  const totalChars = texts.reduce((sum, text) => sum + text.length, 0);
  if (texts.length > MAX_TEXTS || totalChars > MAX_TOTAL_CHARS) {
    return Response.json({ error: "翻訳する文章が長すぎます。" }, { status: 400 });
  }

  // キーの末尾が ":fx" なら無料プラン用、それ以外は有料プラン用のアドレスを使う
  const endpoint = DEEPL_API_KEY.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";

  try {
    // DeepL API に翻訳を頼む（タイ語 → 日本語）
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${DEEPL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: texts, // 配列で送ると、同じ順番で訳が返ってくる
        source_lang: "TH",
        target_lang: "JA",
      }),
    });

    // DeepL がエラーを返したら、番号に応じたメッセージを返す
    if (!res.ok) {
      const message = ERROR_MESSAGES[res.status] ?? DEFAULT_ERROR;
      return Response.json({ error: message }, { status: res.status });
    }

    // 成功したら、訳の文字列だけを取り出して配列にする
    const data = await res.json();
    const translations = (data.translations ?? []).map((item) => item.text);

    return Response.json({ translations });
  } catch (e) {
    // 通信エラーなど、DeepL に届かなかった場合
    return Response.json({ error: DEFAULT_ERROR }, { status: 500 });
  }
}
