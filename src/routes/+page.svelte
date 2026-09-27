<script>
  import { onMount } from "svelte";

  // タブ定義（タブを追加するときはここに1行足す）
  // ※ 下の byTab() でこの一覧を使うので、状態の宣言より前に置く
  const TABS = [
    { id: "ptj", label: "プログレ" },
    { id: "gotthai", label: "ごったい" },
    { id: "nabeta", label: "鍋田" },
    { id: "pdic", label: "PDIC" },
    { id: "thai", label: "ThaiLang" },
    { id: "wiki", label: "Wiki" },
    { id: "orst", label: "学士院" },
  ];

  /**
   * 全タブ分の { タブID: 値 } を作って返す
   * 例：byTab(null) → { ptj: null, gotthai: null, nabeta: null, pdic: null, thai: null }
   * TABS から自動で作るので、タブを追加しても書き換え漏れが起きない
   * @param {*} value - 各タブに入れる初期値
   */
  function byTab(value) {
    return Object.fromEntries(
      TABS.map((tab) => [
        tab.id,
        // 配列はタブごとに別々のものにする（同じ配列を共有しないため）
        Array.isArray(value) ? [...value] : value,
      ]),
    );
  }

  // 検索ワード
  let query = $state("");

  // 現在選択中のタブ
  let activeTab = $state("ptj");

  // 各タブの検索結果と件数（全タブ分キャッシュする）
  let allResults = $state(byTab([]));
  let counts = $state(byTab(null));

  // 現在表示中の結果（アクティブタブのキャッシュを参照）
  let results = $derived(allResults[activeTab] ?? []);

  // ページネーション
  let currentPage = $state(1);
  let totalPages = $state(byTab(1));

  // 検索中フラグ
  let loading = $state(false);

  // バックグラウンド検索中フラグ（タブごと）
  let bgLoading = $state(byTab(false));

  // 検索済みフラグ（初期表示で「見つかりませんでした」を出さないため）
  let searched = $state(false);

  // 検索モード（meaning: 意味検索 / reading: 読み検索）
  let searchMode = $state("meaning");

  // エラーメッセージ
  let errorMessage = $state("");

  // トップへ戻るボタンの表示フラグ
  let showScrollTop = $state(false);

  // 既読フラグをLocalStorageから取得する（SSR対策でonMount内で取得）
  let helpRead = $state(true);

  // 学士院：派生語を開いている語義を覚えておく（"見出し語-sense_no" の形で入れる）
  // Set は中身を変えても画面が更新されないことがあるので、変えるときは作り直す
  let openRelated = $state(new Set());

  /**
   * 学士院の意味を (๑)(๒)… の番号ごとに分けて配列で返す
   * 例："(๑) ก. เคี้ยว (๒) ก. เปลือง" → ["(๑) ก. เคี้ยว", "(๒) ก. เปลือง"]
   * 番号がない意味は、そのまま1行の配列で返す
   * @param {string} text - 学士院の meaning
   */
  function splitSenseNumbers(text) {
    // text が null/undefined の場合は空配列を返す
    if (!text) return [];
    return (
      text
        // 「(タイ数字)」の直前で区切る（(?=...) は「直前」を表すので番号自体は消えない）
        .split(/(?=\([๐-๙]+\))/)
        // 前後の空白を取り除く
        .map((part) => part.trim())
        // 空になった部分（先頭の (๑) の前など）は捨てる
        .filter((part) => part !== "")
    );
  }

  /**
   * 学士院の派生語（カンマ区切りの文字列）を配列にして返す
   * 例："เขากวาง ๑,เขากวางอ่อน,เขาเกก" → ["เขากวาง ๑", "เขากวางอ่อน", "เขาเกก"]
   * @param {string} text - 学士院の related_words
   */
  function splitRelated(text) {
    // text が null/undefined の場合は空配列を返す
    if (!text) return [];
    return text
      .split(",")
      .map((word) => word.trim())
      .filter((word) => word !== "");
  }

  /**
   * 学士院の派生語の開閉を切り替える
   * @param {string} key - "見出し語-sense_no"（例："เข้า-1"）
   */
  function toggleRelated(key) {
    // 今の Set をコピーして新しい Set を作る
    const next = new Set(openRelated);
    // 開いていれば閉じる、閉じていれば開く
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    // 作り直した Set を入れることで画面が更新される
    openRelated = next;
  }

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

    // 全タブの件数・結果をリセットする（TABSにある全タブが対象）
    counts = byTab(null);
    allResults = byTab([]);
    totalPages = byTab(1);

    // 入力言語を判定
    const lang = detectLang(query);

    // 優先タブ（LocalStorageから取得）を先に検索する
    const priorityTab = activeTab;
    const priorityRes = await fetch(`/api/search?q=${encodeURIComponent(query)}&tab=${priorityTab}&mode=${searchMode}&lang=${lang}&page=1`).then((r) => r.json());

    // 優先タブの結果を即座に表示する
    counts = { ...counts, [priorityTab]: priorityRes.count ?? 0 };
    allResults = { ...allResults, [priorityTab]: priorityRes.results ?? [] };
    totalPages = { ...totalPages, [priorityTab]: priorityRes.totalPages ?? 1 };
    loading = false;

    // 残りのタブをバックグラウンドで並列検索する
    const otherTabs = TABS.filter((tab) => tab.id !== priorityTab);
    bgLoading = { ...bgLoading, ...Object.fromEntries(otherTabs.map((tab) => [tab.id, true])) };

    await Promise.all(
      otherTabs.map((tab) =>
        fetch(`/api/search?q=${encodeURIComponent(query)}&tab=${tab.id}&mode=${searchMode}&lang=${lang}&page=1`)
          .then((r) => r.json())
          .then((data) => {
            // 各タブの結果が返ってきたら件数だけ更新する
            counts = { ...counts, [tab.id]: data.count ?? 0 };
            allResults = { ...allResults, [tab.id]: data.results ?? [] };
            totalPages = { ...totalPages, [tab.id]: data.totalPages ?? 1 };
            bgLoading = { ...bgLoading, [tab.id]: false };
          }),
      ),
    );
  }

  /**
   * タブを切り替える
   * キャッシュ済みの結果を表示するだけ（APIは叩かない）
   * @param {string} tabId - 切り替え先のタブID
   */
  function switchTab(tabId) {
    activeTab = tabId;
    // タブをLocalStorageに保存する
    localStorage.setItem("thai_dict_active_tab", tabId);
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
    // 全タブの結果・件数・ページ数をリセットする（TABSにある全タブが対象）
    allResults = byTab([]);
    searched = false;
    counts = byTab(null);
    totalPages = byTab(1);
    currentPage = 1;
    errorMessage = "";
  }

  /**
   * テキスト内の検索ワードをハイライトするHTMLを返す
   * @param {string} text - 対象テキスト
   * @param {string} q - 検索ワード
   * @param {boolean} isExact - 完全一致かどうか（金色ハイライト）
   */
  function highlight(text, q) {
    if (!q || !text) return text;
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.replace(new RegExp(escaped, "g"), `<mark class="highlight">$&</mark>`);
  }

  // 入力言語を判定する関数
  // タイ語 → "thai" / 日本語 → "japanese" / それ以外 → "other"
  function detectLang(q) {
    if (/[\u0E00-\u0E7F]/.test(q)) return "thai";
    if (/[\u3040-\u30FF\u4E00-\u9FFF]/.test(q)) return "japanese";
    return "other";
  }

  /**
   * meaningを行ごとに分割して返す（-------は区切り線に変換）
   * @param {string} text - 対象テキスト
   */
  function splitLines(text) {
    // text が null/undefined の場合は空配列を返す
    if (!text) return [];
    return text.split("\n").map((line) => ({
      isDivider: /^-+$/.test(line.trim()),
      text: line,
    }));
  }

  /**
   * スクロール量を監視してトップへ戻るボタンの表示を切り替える
   */
  function handleScroll() {
    showScrollTop = window.scrollY > 200;
  }

  /**
   * タイ文字だけで構成されているかどうかを判定する
   * @param {string} text - 対象テキスト
   */
  function isThai(text) {
    // スペース・ハイフンを除いた文字が全てタイ文字ならtrue
    return /^[\u0E00-\u0E7F\s\-]+$/.test(text.trim());
  }

  // マウント時にLocalStorageからタブと既読フラグを復元する
  onMount(() => {
    activeTab = localStorage.getItem("thai_dict_active_tab") ?? "ptj";
    helpRead = localStorage.getItem("thai_dict_help_read") === "true";
  });
</script>

<div class="container">
  <div class="title-row">
    <h1>タイ語辞書</h1>
    <a href="/help" class="help-link {helpRead ? 'read' : 'unread'}">使い方</a>
  </div>

  <!-- 検索欄 -->
  <div class="search-box">
    <input type="text" placeholder="タイ語・日本語・英語・読みで検索" bind:value={query} onkeydown={(e) => e.key === "Enter" && handleSearch()} />
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
        {#if bgLoading[tab.id]}
          <span class="count">(...)</span>
        {:else if counts[tab.id] !== null}
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
            <div class="keyword-link" role="link" tabindex="0" onclick={() => window.open(item.url, "_blank")} onkeydown={(e) => e.key === "Enter" && window.open(item.url, "_blank")}>
              {@html highlight(item.thai, query, false)}
            </div>
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
        {:else if activeTab === "nabeta"}
          <!-- 鍋田辞書の結果カード -->
          <div class="card">
            {#if item.source === "nabeta_jp"}
              <!-- 日本語→タイ語カード -->
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <div class="keyword">{@html highlight(item.keyword, query)}</div>
              <div class="meaning nabeta-meaning">
                {#each splitLines(item.content) as line}
                  {#if line.isDivider}
                    <hr class="divider" />
                  {:else}
                    <span class:thai-line={isThai(line.text)}>{line.text}</span><br />
                  {/if}
                {/each}
              </div>
            {:else}
              <!-- タイ語→日本語カード（既存） -->
              <!-- eslint-disable-next-line svelte/no-at-html-tags -->
              <div class="keyword">{@html highlight(item.word, query, false)}</div>
              <div class="meaning nabeta-meaning">
                {#each splitLines(item.meaning) as line}
                  {#if line.isDivider}
                    <hr class="divider" />
                  {:else}
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    <span class:thai-line={isThai(line.text)}>{@html highlight(line.text, query)}</span><br />
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {:else if activeTab === "pdic"}
          <!-- PDICの結果カード -->
          <div class="card">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="keyword">{@html highlight(item.source === "pdic_abbr" ? item.word : (item.disp ?? item.word), query)}</div>
            {#if item.source === "pdic_words" && item.reading}
              <div class="reading">{item.reading}</div>
            {/if}
            <div class="meaning">
              {#if item.source === "pdic_abbr"}
                <!-- 略語の場合はフルネームを表示 -->
                <span class="abbr-label">略語</span><span class="abbr-full">{item.full_word}</span>
              {:else if item.source === "pdic_ja_words"}
                <!-- 日→タイ辞書の場合はtransとphoneを表示 -->
                <span class="thai-line">{@html highlight(item.trans ?? "", query)}</span>
                {#if item.phone}
                  <div class="reading">{item.phone}</div>
                {/if}
              {:else}
                <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                {@html highlight(item.meaning, query)}
                {#if item.sample}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="reading">{@html highlight(item.sample, query)}</div>
                {/if}
              {/if}
            </div>
          </div>
        {:else if activeTab === "thai"}
          <!-- thai-language.comの結果カード -->
          <div class="card">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="keyword-link" role="link" tabindex="0" onclick={() => window.open(item.url, "_blank")} onkeydown={(e) => e.key === "Enter" && window.open(item.url, "_blank")}>
              {@html highlight(item.word, query, false)}
            </div>
            <!-- meaningはJSON形式なのでパースして表示する -->
            {#each (() => {
              try {
                return JSON.parse(item.meaning);
              } catch {
                return [];
              }
            })() as entry}
              <div class="meaning thai-meaning">
                {#if entry.category}
                  <span class="category">{entry.category}</span>
                {/if}
                {@html highlight(entry.meaning, query, false)}
              </div>
            {/each}
          </div>
        {:else if activeTab === "wiki"}
          <!-- Wiktionaryの結果カード（同じ見出し語の品詞をまとめて1枚で表示） -->
          <div class="card">
            <!-- 見出し語：クリックするとWiktionaryのページを別タブで開く -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div
              class="keyword-link"
              role="link"
              tabindex="0"
              onclick={() => window.open(`https://th.wiktionary.org/wiki/${encodeURIComponent(item.word)}`, "_blank")}
              onkeydown={(e) => e.key === "Enter" && window.open(`https://th.wiktionary.org/wiki/${encodeURIComponent(item.word)}`, "_blank")}
            >
              {@html highlight(item.word, query)}
            </div>
            <!-- 読み（Paiboon式）：ないときは表示しない -->
            {#if item.reading_paiboon}
              <div class="reading">{item.reading_paiboon}</div>
            {/if}
            <!-- 品詞ごとのかたまりを順番に表示する -->
            {#each item.entries as entry}
              <div class="wiki-entry">
                <!-- 品詞：pos_title（pos） の形。pos がないときは括弧なし -->
                <div class="wiki-pos">
                  {entry.pos_title}{#if entry.pos}（{entry.pos}）{/if}
                </div>
                <!-- 意味：改行ごとに1行ずつ表示する（検索対象外なのでハイライトしない） -->
                <div class="wiki-meaning">
                  {#each splitLines(entry.meaning) as line}
                    <div>{line.text}</div>
                  {/each}
                </div>
                <!-- 英語訳：ないときは表示しない（英語検索の対象なのでハイライトする） -->
                {#if entry.meaning_en}
                  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                  <div class="wiki-meaning-en">{@html highlight(entry.meaning_en, query)}</div>
                {/if}
              </div>
            {/each}
          </div>
        {:else if activeTab === "orst"}
          <!-- 王立学士院辞書の結果カード（同じ見出し語の語義をまとめて1枚で表示） -->
          <div class="card">
            <!-- 見出し語（リンクなし・タイ語検索の対象なのでハイライトする） -->
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="keyword">{@html highlight(item.word, query)}</div>
            <!-- 語義ごとのかたまりを順番に表示する -->
            {#each item.senses as sense}
              <div class="orst-sense">
                <!-- 語義ラベル（เขา ๑ など）：語義が2つ以上あるときだけ表示する -->
                {#if item.senses.length > 1}
                  <div class="orst-label">{sense.sense_label}</div>
                {/if}
                <!-- 意味：(๑)(๒)… の番号ごとに1行ずつ表示する（検索対象外なのでハイライトしない） -->
                <div class="orst-meaning">
                  {#each splitSenseNumbers(sense.meaning) as line}
                    <div>{line}</div>
                  {/each}
                </div>
                <!-- 派生語：あるときだけ表示。最初は閉じていて、タップで開閉する -->
                {#if sense.related_words}
                  {@const related = splitRelated(sense.related_words)}
                  {@const key = `${item.word}-${sense.sense_no}`}
                  <button class="orst-related-toggle" onclick={() => toggleRelated(key)}>
                    派生語（{related.length}）{openRelated.has(key) ? "▼" : "▶"}
                  </button>
                  {#if openRelated.has(key)}
                    <div class="orst-related">
                      {#each related as relatedWord}
                        <span class="orst-related-word">{relatedWord}</span>
                      {/each}
                    </div>
                  {/if}
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <!-- プログレッシブの結果カード -->
          <div class="card">
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div
              class="keyword-link"
              role="link"
              tabindex="0"
              onclick={() =>
                window.open(
                  `/detail/${item.source === "ptj_sub" ? "sub" : "words"}/${item.no}?q=${encodeURIComponent(query)}&keyword=${encodeURIComponent(item.keyword)}&lang=${detectLang(query)}`,
                  "_blank",
                )}
              onkeydown={(e) =>
                e.key === "Enter" &&
                window.open(
                  `/detail/${item.source === "ptj_sub" ? "sub" : "words"}/${item.no}?q=${encodeURIComponent(query)}&keyword=${encodeURIComponent(item.keyword)}&lang=${detectLang(query)}`,
                  "_blank",
                )}
            >
              {@html highlight(item.keyword, query, false)}
            </div>
            {#if item.reading}
              <div class="reading">{item.reading}</div>
            {/if}
            <!-- eslint-disable-next-line svelte/no-at-html-tags -->
            <div class="meaning">{@html highlight(item.meaning, query, false)}</div>
          </div>
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

<!-- トップへ戻るボタン -->
<svelte:window onscroll={handleScroll} />
{#if showScrollTop}
  <button class="scroll-top-btn" onclick={() => window.scrollTo({ top: 0 })}>↑</button>
{/if}

<style>
  @import url("https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap");

  .container {
    /* 最大幅（タブレット縦向きでほぼ画面いっぱいになる幅） */
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 16px;
    font-family: "Sarabun", sans-serif;
  }

  h1 {
    font-size: 24px;
    margin-bottom: 0;
  }

  /* タイトル行（タイトル＋使い方リンク） */
  .title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }

  /* 使い方リンク */
  .help-link {
    font-size: 13px;
    text-decoration: none;
    border-radius: 4px;
    padding: 4px 10px;
  }

  /* 未読：オレンジ＋ぷるぷるアニメーション */
  .help-link.unread {
    color: white;
    background: #e07b00;
    animation: wobble 1.2s ease-in-out infinite;
  }

  /* 既読：グレー */
  .help-link.read {
    color: #888;
    background: #f0f0f0;
  }

  @keyframes wobble {
    0%,
    100% {
      transform: rotate(0deg);
    }
    20% {
      transform: rotate(-6deg);
    }
    40% {
      transform: rotate(6deg);
    }
    60% {
      transform: rotate(-4deg);
    }
    80% {
      transform: rotate(4deg);
    }
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

  .search-box input::placeholder {
    font-size: 13px;
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

  /* タブ（はみ出したら横スクロールする） */
  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 16px;
    /* 横方向にはみ出したらスクロールできるようにする */
    overflow-x: auto;
    /* スクロールバーを細くする（Firefox・Chrome対応） */
    scrollbar-width: thin;
    /* 下のグレー線：border だとスクロール時に子要素の下線と重ならないので、内側の影で描く */
    box-shadow: inset 0 -2px 0 #e0e0e0;
  }

  .tab {
    padding: 8px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: 14px;
    cursor: pointer;
    color: #666;
    /* はみ出しても縮めない（横スクロールさせるため） */
    flex-shrink: 0;
    /* タブの文字を折り返さない */
    white-space: nowrap;
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

  /* 見出し語リンク */
  .keyword-link {
    display: inline-block;
    font-size: 20px;
    font-weight: bold;
    margin-bottom: 4px;
    color: #1a6fb5;
    cursor: pointer;
  }

  .keyword-link:hover {
    text-decoration: underline;
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

  /* 鍋田辞書のmeaning（改行を表示する） */
  .nabeta-meaning {
    white-space: pre-wrap;
    line-height: 1.6;
  }

  /* meaningの中のタイ文字行は大きく表示 */
  .thai-line {
    font-size: 20px;
    font-family: "Sarabun", sans-serif;
  }

  /* トップへ戻るボタン */
  .scroll-top-btn {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 44px;
    height: 44px;
    background: #1a7f5a;
    color: white;
    border: none;
    border-radius: 50%;
    font-size: 20px;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .scroll-top-btn:hover {
    background: #155f44;
  }

  /* カテゴリー */
  .category {
    font-size: 12px;
    color: #888;
    margin-bottom: 4px;
  }

  /* thai-languageのmeaning（他辞書より大きく表示） */
  .thai-meaning {
    font-size: 16px;
    color: #333;
  }

  /* 区切り線 */
  .divider {
    border: none;
    border-top: 1px solid #e0e0e0;
    margin: 8px 0;
  }

  /* PDIC略語ラベル */
  .abbr-label {
    font-size: 11px;
    color: white;
    background: #888;
    border-radius: 3px;
    padding: 1px 6px;
    margin-right: 6px;
  }

  /* PDIC略語のフルネーム（タイ文字なので大きく表示） */
  .abbr-full {
    font-size: 20px;
  }

  /* Wiktionary：品詞ごとのかたまり（上に薄い区切り線） */
  .wiki-entry {
    border-top: 1px solid #e0e0e0;
    margin-top: 8px;
    padding-top: 8px;
  }

  /* Wiktionary：品詞ラベル（小さいグレー） */
  .wiki-pos {
    font-size: 12px;
    color: #888;
    margin-bottom: 4px;
  }

  /* Wiktionary：意味（タイ語なので少し大きめ） */
  .wiki-meaning {
    font-size: 16px;
    color: #333;
    line-height: 1.6;
  }

  /* Wiktionary：英語訳（小さいグレー） */
  .wiki-meaning-en {
    font-size: 13px;
    color: #888;
    margin-top: 4px;
  }

  /* 学士院：語義ごとのかたまり（上に薄い区切り線） */
  .orst-sense {
    border-top: 1px solid #e0e0e0;
    margin-top: 8px;
    padding-top: 8px;
  }

  /* 学士院：語義ラベル（เขา ๑ など、小さいグレー） */
  .orst-label {
    font-size: 12px;
    color: #888;
    margin-bottom: 4px;
  }

  /* 学士院：意味（タイ語なので少し大きめ） */
  .orst-meaning {
    font-size: 16px;
    color: #333;
    line-height: 1.6;
  }

  /* 学士院：派生語の開閉ボタン（文字だけのボタン） */
  .orst-related-toggle {
    margin-top: 6px;
    padding: 2px 0;
    background: none;
    border: none;
    font-size: 13px;
    color: #1a7f5a;
    cursor: pointer;
  }

  /* 学士院：派生語の一覧（タグのように折り返して並べる） */
  .orst-related {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }

  /* 学士院：派生語1つ分のタグ */
  .orst-related-word {
    font-size: 14px;
    background: #f0f0f0;
    border-radius: 4px;
    padding: 2px 8px;
  }
</style>
