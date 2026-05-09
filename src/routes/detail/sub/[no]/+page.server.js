import { createClient } from "@supabase/supabase-js";
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from "$env/static/public";
import { error } from "@sveltejs/kit";

// Supabaseクライアントを作成
const supabase = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY);

/**
 * ptj_sub詳細ページのサーバーサイド処理
 * noでptj_subを検索してparent_keywordからptj_wordsのraw_htmlを返す
 */
export async function load({ params }) {
  const no = parseInt(params.no);

  // noでptj_subを検索してparent_keywordを取得
  const { data: subData, error: subError } = await supabase.from("ptj_sub").select("no, keyword, parent_keyword").eq("no", no).maybeSingle();

  if (subError) throw error(500, subError.message);
  if (!subData) throw error(404, "見つかりませんでした");

  // parent_keywordでptj_wordsを検索
  const { data: parentData, error: parentError } = await supabase.from("ptj_words").select("id, no, keyword, reading, meaning, raw_html").eq("keyword", subData.parent_keyword).maybeSingle();

  if (parentError) throw error(500, parentError.message);
  if (!parentData) throw error(404, "見つかりませんでした");

  return { word: parentData };
}
