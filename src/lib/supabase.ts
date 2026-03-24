import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  'https://prtkfwwqpcziexgipoqk.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBydGtmd3dxcGN6aWV4Z2lwb3FrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MTc4NjYsImV4cCI6MjA4OTE5Mzg2Nn0.0OOS1qifS3bj5C9OKpFZse4fniLXbVmyY1zFPRE4WNA'
);
