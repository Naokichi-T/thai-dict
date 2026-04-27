<script>
  // 検索ワード
  let query = $state("");

  // 現在選択中のタブ
  let activeTab = $state("ptj");

  // 各タブの検索結果と件数（全タブ分キャッシュする）
  let allResults = $state({ ptj: [], gotthai: [], nabeta: [], thai: [] });
  let counts = $state({ ptj: null, gotthai: null, nabeta: null, thai: null });

  // 現在表示中の結果（アクティブタブのキャッシュを参照）
  let results = $derived(allResults[activeTab] ?? []);

  // ページネーション
  let currentPage = $state(1);
  let totalPages = $state({ ptj: 1, gotthai: 1, nabeta: 1, thai: 1 });

  // 検索中フラグ
  let loading = $state(false);

  // 検索済みフラグ（初期表示で「見つかりませんでした」を出さないため）
  let searched = $state(false);

  // 検索モード（meaning: 意味検索 / reading: 読み検索）
  let searchMode = $state("meaning");

  // エラーメッセージ
  let errorMessage = $state("");

  // タブ定義
  const TABS = [
    { id: "gotthai", label: "ごったい" },
    { id: "ptj", label: "プログレッシブ" },
    { id: "nabeta", label: "鍋田" },
    { id: "thai", label: "thai-language" },
  ];

  /**
   * 検索を実行する
   * 全タブの件数を取得してから、アクティブタブの結果を表示する
   */
  async function handleSearch() {
    if (!query.trim()) return;

    // 読みモードのときASCII以外はエラー
    if (searchMode === "reading" && /[^\x00-\x7F]/.test(query)) {
      errorMessage = "読みはアルファベットで入力してください";
      return;
    }
    errorMessage = "";

    loading = true;
    searched = true;
    currentPage = 1;

    // 入力言語を判定
    const lang = detectLang(query);

    const responses = await Promise.all(
      TABS.map((tab) =>
        fetch(`/api/search?q=${encodeURIComponent(query)}&tab=${tab.id}&mode=${searchMode}&lang=${lang}&page=1`)
          .then((r) => r.json())
          .then((data) => ({ id: tab.id, count: data.count ?? 0, results: data.results ?? [], totalPages: data.totalPages ?? 1 })),
      ),
    );

    // 件数・結果・総ページ数をセット（全タブ分まとめて保存）
    counts = Object.fromEntries(responses.map((r) => [r.id, r.count]));
    allResults = Object.fromEntries(responses.map((r) => [r.id, r.results]));
    totalPages = Object.fromEntries(responses.map((r) => [r.id, r.totalPages]));

    loading = false;
  }

  /**
   * タブを切り替える
   * キャッシュ済みの結果を表示するだけ（APIは叩かない）
   * @param {string} tabId - 切り替え先のタブID
   */
  function switchTab(tabId) {
    activeTab = tabId;
  }

  /**
   * ページを切り替える
   * @param {number} newPage - 切り替え先のページ番号
   */
  async function changePage(newPage) {
    if (newPage < 1 || newPage > totalPages[activeTab]) return;

    loading = true;
    currentPage = newPage;

    const lang = detectLang(query);
    const res = await fetch(`/api/search?q=${encodeURIComponent(query)}&tab=${activeTab}&mode=${searchMode}&lang=${lang}&page=${newPage}`);
    const data = await res.json();

    // アクティブタブの結果を更新
    allResults = { ...allResults, [activeTab]: data.results ?? [] };

    loading = false;
  }

  /**
   * 検索欄をクリアする
   */
  function clearQuery() {
    query = "";
    allResults = { ptj: [], gotthai: [], nabeta: [], thai: [] };
    searched = false;
    counts = { ptj: null, gotthai: null, nabeta: null, thai: null };
    totalPages = { ptj: 1, gotthai: 1, nabeta: 1, thai: 1 };
    currentPage = 1;
    errorMessage = "";
  }

  /**
   * テキスト内の検索ワードをハイライトするHTMLを返す
   * @param {string} text - 対象テキスト
   * @param {string} q - 検索ワード
   * @param {boolean} isExact - 完全一致かどうか（金色ハイライト）
   */
  function highlight(text, q, isExact = false) {
    if (!q || !text) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const className = isExact ? "highlight-exact" : "highlight";
    return text.replace(new RegExp(escaped, "g"), `<mark class="${className}">$&</mark>`);
  }

  // 入力言語を判定する関数
  // タイ語 → "thai" / 日本語 → "japanese" / それ以外 → "other"
  function detectLang(q) {
    if (/[\u0E00-\u0E7F]/.test(q)) return "thai";
    if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(q)) return "japanese";
    return "other";
  }
</script>

<div class="container">
  <h1>タイ語辞書</h1>

  <!-- 検索欄 -->
  <div class="search-box">
    <input type="text" placeholder="タイ語・日本語・読みで検索" bind:value={query} onkeydown={(e) => e.key === "Enter" && handleSearch()} />
    {#if query}
      <button class="clear-btn" onclick={clearQuery}>✕</button>
    {/if}
    <button class="search-btn" onclick={handleSearch}>検索</button>
  </div>

  <!-- 検索モード切り替え -->
  <div class="search-mode">
    <label>
      <input type="radio" bind:group={searchMode} value="meaning" />
      意味
    </label>
    <label>
      <input type="radio" bind:group={searchMode} value="reading" />
      読み
    </label>
  </div>

  <!-- エラーメッセージ -->
  {#if errorMessage}
    <p class="error">{errorMessage}</p>
  {/if}

  <!-- タブ -->
  <div class="tabs">
    {#each TABS as tab}
      <button class="tab {activeTab === tab.id ? 'active' : ''}" onclick={() => switchTab(tab.id)}>
        {tab.label}
        {#if counts[tab.id] !== null}
          <span class="count">({counts[tab.id]})</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- 検索結果 -->
  <div class="results">
    {#if loading}
      <p class="message">検索中...</p>
    {:else if searched && results.length === 0}
      <p class="message">見つかりませんでした</p>
    {:else}
      {#each results as item}
        {#if activeTab === "gotthai"}
          <!-- ごったいの結果カード -->
          <div class="card">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="keyword">{@html highlight(item.thai, query, item.score === 3)}</div>
            {#if item.reading}
              <div class="reading">{item.reading}</div>
            {/if}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="meaning">{@html highlight(item.meaning, query, false)}</div>
            <div class="meta">
              {#if item.frequency}
                <span class="badge">頻出度 {item.frequency}</span>
              {/if}
              {#if item.formality}
                <span class="badge">フォーマル度 {item.formality}</span>
              {/if}
            </div>
          </div>
        {:else}
          <!-- プログレッシブの結果カード -->
          <a
            class="card"
            href="/detail/{item.source === 'ptj_sub' ? 'sub' : 'words'}/{item.no}?q={encodeURIComponent(query)}&keyword={encodeURIComponent(item.keyword)}&lang={detectLang(query)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="keyword">{@html highlight(item.keyword, query, item.score >= 3)}</div>
            {#if item.reading}
              <div class="reading">{item.reading}</div>
            {/if}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="meaning">{@html highlight(item.meaning, query, false)}</div>
          </a>
        {/if}
      {/each}

      <!-- ページネーション -->
      {#if totalPages[activeTab] > 1}
        <div class="pagination">
          <button class="page-btn" onclick={() => changePage(currentPage - 1)} disabled={currentPage === 1}> ← 前へ </button>
          <span class="page-info">{currentPage} / {totalPages[activeTab]}</span>
          <button class="page-btn" onclick={() => changePage(currentPage + 1)} disabled={currentPage === totalPages[activeTab]}> 次へ → </button>
        </div>
      {/if}
    {/if}
  </div>
</div>

<style>
  @import url("https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap");

  .container {
    max-width: 680px;
    margin: 0 auto;
    padding: 24px 16px;
    font-family: "Sarabun", sans-serif;
  }

  h1 {
    font-size: 24px;
    margin-bottom: 16px;
  }

  /* 検索欄 */
  .search-box {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
    position: relative;
  }

  .search-box input {
    flex: 1;
    padding: 10px 36px 10px 12px;
    font-size: 16px;
    border: 1px solid #ccc;
    border-radius: 8px;
  }

  .clear-btn {
    position: absolute;
    right: 76px;
    top: 50%;
    transform: translateY(-50%);
    background: #e0e0e0;
    border: none;
    border-radius: 50%;
    color: #555;
    font-size: 16px;
    cursor: pointer;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .clear-btn:hover {
    background: #ccc;
    color: #333;
  }

  /* 検索モード切り替え */
  .search-mode {
    display: flex;
    gap: 16px;
    margin-bottom: 12px;
    font-size: 14px;
    color: #555;
  }

  .search-mode label {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
  }

  /* エラーメッセージ */
  .error {
    color: #e53e3e;
    font-size: 13px;
    margin-bottom: 8px;
  }

  .search-btn {
    padding: 10px 16px;
    background: #1a7f5a;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 16px;
    cursor: pointer;
  }

  .search-btn:hover {
    background: #155f44;
  }

  /* タブ */
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    border-bottom: 2px solid #e0e0e0;
  }

  .tab {
    padding: 8px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -2px;
    font-size: 14px;
    cursor: pointer;
    color: #666;
  }

  .tab.active {
    color: #1a7f5a;
    border-bottom-color: #1a7f5a;
    font-weight: bold;
  }

  .count {
    font-size: 12px;
    color: #999;
  }

  .tab.active .count {
    color: #1a7f5a;
  }

  /* 結果カード */
  .card {
    border: 1px solid #e0e0e0;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 8px;
  }

  .keyword {
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 4px;
  }

  .reading {
    font-size: 16px;
    color: #888;
    margin-bottom: 4px;
    font-family: "Times New Roman", Times, "ヒラギノ明朝 ProN", "Hiragino Mincho ProN", "YuMincho", "Yu Mincho", "メイリオ", Meiryo, "ＭＳ Ｐゴシック", serif;
  }

  .meaning {
    font-size: 14px;
    color: #333;
  }

  .message {
    text-align: center;
    color: #999;
    margin-top: 32px;
  }

  /* ハイライト（部分一致）*/
  :global(mark.highlight) {
    background-color: #c8f0dc;
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }

  /* ハイライト（完全一致）*/
  :global(mark.highlight-exact) {
    background-color: #ffe066;
    color: inherit;
    border-radius: 2px;
    padding: 0 1px;
  }

  /* カードをリンクにしたときの装飾リセット */
  a.card {
    display: block;
    color: inherit;
    text-decoration: none;
  }

  a.card:hover {
    border-color: #1a7f5a;
    cursor: pointer;
  }

  /* ページネーション */
  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid #e0e0e0;
  }

  .page-btn {
    padding: 8px 16px;
    background: #1a7f5a;
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
  }

  .page-btn:disabled {
    background: #ccc;
    cursor: default;
  }

  .page-btn:not(:disabled):hover {
    background: #155f44;
  }

  .page-info {
    font-size: 14px;
    color: #555;
  }

  /* メタ情報（頻出度・フォーマル度） */
  .meta {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }

  .badge {
    font-size: 12px;
    color: #555;
    background: #f0f0f0;
    border-radius: 4px;
    padding: 2px 8px;
  }
</style>
