import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://prtkfwwqpcziexgipoqk.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBydGtmd3dxcGN6aWV4Z2lwb3FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MTc4NjYsImV4cCI6MjA4OTE5Mzg2Nn0.FkrjPW0qBacrGXFkvSoVYLAbGhFRd-P0-8CUpEf9a7k';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
