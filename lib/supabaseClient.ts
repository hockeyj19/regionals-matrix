import { createClient } from "@/lib/supabase";

// single shared browser client for the whole app
export const supabase = createClient();
