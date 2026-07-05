/**
 * Shared Supabase client (service role). Import this everywhere instead of
 * instantiating per-file.
 */

import { createClient } from "@supabase/supabase-js";
import { config } from "../config.js";

export const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
