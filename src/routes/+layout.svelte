<script>
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <!-- iPhoneのホーム画面に追加したときのアイコン（staticフォルダのpngを指す） -->
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

  <!-- 検索結果に出る説明文 -->
  <meta name="description" content="タイ語・日本語・英語・読みで検索できるタイ語辞書。8つの辞書をまとめて調べられます。" />

  <!-- OGP：LINEやXなどにURLを貼ったときに出るカードの内容 -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="タイ語辞書" />
  <meta property="og:title" content="タイ語辞書" />
  <meta property="og:description" content="タイ語・日本語・英語・読みで検索できるタイ語辞書。8つの辞書をまとめて調べられます。" />
  <meta property="og:url" content="https://thai-dict.vercel.app/" />
  <!-- 画像のURLは https:// から始まる完全な形で書く -->
  <meta property="og:image" content="https://thai-dict.vercel.app/ogp.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <!-- Xで大きい画像のカードにする指定 -->
  <meta name="twitter:card" content="summary_large_image" />
</svelte:head>

{@render children()}
