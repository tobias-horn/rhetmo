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

    // Check if conversation_id is provided in the request body
    let conversationId: string | null = null;
    try {
      const body = await req.json();
      conversationId = body.conversation_id || null;
    } catch {
      // No body or invalid JSON - will fetch newest file
    }

    let fileName: string;

    if (conversationId) {
      // Fetch specific analysis by conversation ID
      fileName = `${conversationId}-analysis.json`;
      console.log(`Fetching analysis for conversation: ${conversationId}`);
    } else {
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
      fileName = data[0].name;
      console.log(`Fetching newest analysis: ${fileName}`);
    }

    // Download the file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("a")
      .download(fileName);
    
    if (downloadError) {
      console.error(`Failed to download ${fileName}:`, downloadError);
      return new Response(
        JSON.stringify({ error: `Analysis not found: ${fileName}` }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Return the file directly
    return new Response(fileData, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Content-Disposition": `inline; filename="${fileName}"`,
      },
    });
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});