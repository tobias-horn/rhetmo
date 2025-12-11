import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );
    // List newest file in bucket "a"
    const { data, error } = await supabase.storage
      .from("a")
      .list("", {
        limit: 1,
        sortBy: { column: "created_at", order: "desc" },
      });
    if (error) throw error;
    if (!data || data.length === 0) {
      return new Response(
        JSON.stringify({ error: "No files found in bucket" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const newestFile = data[0];
    // Download the file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("a")
      .download(newestFile.name);
    if (downloadError) throw downloadError;
    // Return the file directly
    return new Response(fileData, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": newestFile.metadata?.mimetype || "application/octet-stream",
        "Content-Disposition": `inline; filename="${newestFile.name}"`,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});




