<script>
  import { onMount } from "svelte";

  // ページを開いたら既読フラグをLocalStorageに保存する
  onMount(() => {
    localStorage.setItem("thai_dict_help_read", "true");
  });
</script>

<div class="container">
  <a href="/" class="back-link">← 辞書に戻る</a>

  <h1>タイ語辞典について</h1>

  <section>
    <h2>辞書の特徴</h2>
    <p>この辞書は4つのオンライン辞書を横断して検索できる辞書です。</p>
    <ul>
      <li><a href="https://kotobank.jp/dictionary/ptj/" target="_blank">プログレッシブタイ語辞典（コトバンク）</a></li>
      <li><a href="https://www.gotthai.net/" target="_blank">ごったい</a></li>
      <li><a href="https://onlinedict.tk/onlinethai/" target="_blank">鍋田辞書P</a></li>
      <li><a href="http://www.thai-language.com/" target="_blank">thai-language.com</a></li>
    </ul>
  </section>

  <section>
    <h2>注意事項</h2>
    <p>非公式の辞書です。SNS等では拡散しないでください。</p>
  </section>

  <section>
    <h2>読みの検索について</h2>
    <p>ごったいとほぼ同じですが多少不便です。発音記号そのままでは検索できないので次のように読み替えてください。</p>
    <p class="convert">ʉ → u, ə → u, ɛ → e, ɔ → o, ŋ → ng</p>
    <p>例：ชื่อ（chʉ̂ʉ → chuu）、พ่อแม่（phɔ̂ɔmɛ̂ɛ → phoomee）、เงิน（ŋən → ngun）</p>
    <p>また、一部表記ゆれを許容しています。</p>
    <p class="convert">y → i, w → o, ng → n</p>
    <p>例：เลย（luuy / luui）、เขา（khaw / khao）、ครั้ง（khrang / khran）</p>
    <p class="note">ただし、y, w, ng が2種類以上含まれると上手く検索できないことがあります。</p>
  </section>

  <section>
    <h2>お問い合わせ</h2>
    <p><a href="https://docs.google.com/forms/d/e/1FAIpQLSfWPm7MpSFR9EBj8nJpdhh4gIurB4lDgQI1_oJFdXqxTq-Iww/viewform?usp=publish-editor" target="_blank">こちら</a>よりお願いします。</p>
  </section>
</div>

<style>
  .container {
    max-width: 680px;
    margin: 0 auto;
    padding: 24px 16px;
    font-family: Arial, Helvetica, sans-serif;
  }

  .back-link {
    display: inline-block;
    margin-bottom: 24px;
    color: #1a7f5a;
    text-decoration: none;
    font-size: 14px;
  }

  .back-link:hover {
    text-decoration: underline;
  }

  h1 {
    font-size: 24px;
    margin-bottom: 24px;
  }

  h2 {
    font-size: 18px;
    margin-bottom: 8px;
    color: #333;
    border-left: 4px solid #1a7f5a;
    padding-left: 8px;
  }

  section {
    margin-bottom: 32px;
  }

  p {
    font-size: 14px;
    color: #333;
    line-height: 1.8;
    margin-bottom: 8px;
  }

  ul {
    font-size: 14px;
    color: #333;
    line-height: 2;
    padding-left: 20px;
  }

  a {
    color: #1a6fb5;
  }

  a:hover {
    text-decoration: underline;
  }

  /* 変換例のコードブロック風表示 */
  .convert {
    font-family: Arial, Helvetica, sans-serif;
    background: #f5f5f5;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 14px;
  }

  /* 注意書き */
  .note {
    color: #888;
    font-size: 13px;
  }
</style>
