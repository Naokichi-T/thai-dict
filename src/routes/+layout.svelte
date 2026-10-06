<script>
  import favicon from "$lib/assets/favicon.svg";

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <!-- iPhoneのホーム画面に追加したときのアイコン（staticフォルダのpngを指す） -->
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</svelte:head>

{@render children()}
