import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Variáveis de ambiente Supabase não configuradas.\n' +
    'Crie um arquivo .env.local com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.\n' +
    'Consulte o .env.example para referência.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
