export type CopyOffer = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string;
  niche: string | null;
  ad_library_url: string | null;
  page_url: string | null;
  notes: string | null;
  status: string | null;
};

export type CopyOfferTracking = {
  id: string;
  created_at: string;
  offer_id: string | null;
  day_number: number | null;
  tracked_date: string | null;
  active_ads_count: number | null;
  notes: string | null;
};

export type CopyHook = {
  id: string;
  created_at: string;
  updated_at: string;
  hook_text: string;
  hook_type: string | null;
  objective: string | null;
  format: string[] | null;
  example: string | null;
  notes: string | null;
  is_favorite: boolean | null;
};

export type CopyAdSwipe = {
  id: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  niche: string | null;
  /**
   * De onde veio o ad: `'interno'` (criativo nosso) ou `'externo'` (anúncio de
   * terceiro guardado como referência).
   *
   * O banco tem `NOT NULL` e um CHECK com esses dois valores, então aqui não
   * é opcional: a união fecha o conjunto e um valor novo no SQL vira erro de
   * compilação, não coluna em branco na tela.
   */
  source: 'interno' | 'externo';
  body: string | null;
  headline: string | null;
  cta: string | null;
  format: string | null;
  angle: string | null;
  hook_type: string | null;
  notes: string | null;
  is_validated: boolean | null;
  is_favorite: boolean | null;
  ad_code: string | null;
};
