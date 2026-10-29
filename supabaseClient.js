import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vxwbuleusakxyzogfzvv.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4d2J1bGV1c2GetTypeIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI1MDI0OTYsImV4cCI6MjEwODA3ODQ5Nn0.qIerZp_sDWuGDIJ5b7i2q8vQq3_htRtwrrSAmLVeUcE'

export const supabase = createClient(supabaseUrl, supabaseKey)
