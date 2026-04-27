import { createClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public";
import { error } from "@sveltejs/kit";

// Supabaseクライアントを作成
const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

/**
 * ptj_words詳細ページのサーバーサイド処理
 * noでptj_wordsを検索してraw_htmlを返す
 */
export async function load({ params }) {
  const no = parseInt(params.no);

  // noでptj_wordsを検索
  const { data: wordData, error: wordError } = await supabase.from("ptj_words").select("id, no, keyword, reading, meaning, raw_html").eq("no", no).maybeSingle();

  if (wordError) throw error(500, wordError.message);
  if (!wordData) throw error(404, "見つかりませんでした");

  return { word: wordData };
}
