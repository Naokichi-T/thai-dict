<script>
  import { page } from "$app/stores";

  // サーバーから受け取ったデータ
  let { data } = $props();

  // ハイライト対象
  // タイ語検索のときはクリックしたカードのkeyword、それ以外は検索ワード
  const lang = $page.url.searchParams.get("lang") ?? "other";
  const q = lang === "thai" ? ($page.url.searchParams.get("keyword") ?? $page.url.searchParams.get("q") ?? "") : ($page.url.searchParams.get("q") ?? "");

  /**
   * テキスト内の検索ワードをハイライトするHTMLを返す
   * @param {string} html - 対象HTML
   * @param {string} q - 検索ワード
   */
  function highlightInHtml(html, q) {
    if (!html) return html;
    // ⇒見出し などの内部リンク（/thjaword/...）を無効化する
    html = html.replace(/<a\s+href="\/thjaword\/[^"]*"[^>]*>(.*?)<\/a>/g, "$1");
    if (!q) return html;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return html.replace(new RegExp(escaped, "g"), `<mark class="highlight">$&</mark>`);
  }
</script>

<div class="container">
  <div class="header">
    <h1>{data.word.keyword}</h1>
    {#if data.word.reading}
      <p class="reading">{data.word.reading}</p>
    {/if}
  </div>

  <!-- raw_htmlをそのまま表示・検索ワードをハイライト -->
  <div class="dict-content">
    {@html highlightInHtml(data.word.raw_html, q)}
  </div>
</div>

<style>
  .container {
    max-width: 680px;
    margin: 0 auto;
    padding: 24px 16px;
    /* font-family: "Times New Roman", Times, "ヒラギノ明朝 ProN", "Hiragino Mincho ProN", "YuMincho", "Yu Mincho", "メイリオ", Meiryo, "ＭＳ Ｐゴシック", serif; */
    font-family: Arial, Helvetica, sans-serif;
  }

  .header {
    margin-bottom: 16px;
    padding-bottom: 16px;
    border-bottom: 2px solid #e0e0e0;
  }

  h1 {
    font-size: 28px;
    font-weight: bold;
    margin-bottom: 4px;
  }

  .reading {
    font-size: 18px;
    color: #888;
  }

  /* 辞書HTMLのスタイル */
  .dict-content {
    font-size: 20px;
    line-height: 1.8;
    color: #333;
  }

  /* markタグのブラウザデフォルトスタイルを上書きする */
  :global(mark) {
    background-color: unset;
    color: unset;
  }

  /* ハイライト */
  :global(mark.highlight) {
    background-color: #c8f0dc;
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }
</style>
