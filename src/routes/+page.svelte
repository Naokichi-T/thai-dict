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
    results = [];

    // 入力言語を判定
    const lang = detectLang(query);
    // 全タブを同時に検索して件数を取得
    const responses = await Promise.all(
      TABS.map((tab) =>
        fetch(`/api/search?q=${encodeURIComponent(query)}&tab=${tab.id}&mode=${searchMode}&lang=${lang}`)
          .then((r) => r.json())
          .then((data) => ({ id: tab.id, count: data.count ?? 0, results: data.results ?? [] })),
      ),
    );

    // 件数と結果をセット（全タブ分まとめて保存）
    counts = Object.fromEntries(responses.map((r) => [r.id, r.count]));
    allResults = Object.fromEntries(responses.map((r) => [r.id, r.results]));

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
   * 検索欄をクリアする
   */
  function clearQuery() {
    query = "";
    allResults = { ptj: [], gotthai: [], nabeta: [], thai: [] };
    searched = false;
    counts = { ptj: null, gotthai: null, nabeta: null, thai: null };
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
      {/each}
    {/if}
  </div>
</div>

<style>
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
    font-size: 13px;
    color: #888;
    margin-bottom: 4px;
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
</style>
