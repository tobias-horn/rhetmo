// supabase/functions/update-conversation-status/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UpdateStatusRequest {
  conversation_id: string;
  status: "recording" | "processing" | "finished";
}

interface ConversationResponse {
  conversation_id: string;
  timestamp: number;
  status: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role key to bypass RLS
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Parse request body (allow empty body for GET-like behavior)
    let conversation_id: string | undefined;
    let status: string | undefined;

    try {
      const body = await req.json();
      conversation_id = body.conversation_id;
      status = body.status;
    } catch {
      // Empty body is acceptable - just fetch all conversations
    }

    // If status is provided, update a conversation
    if (status) {
      // Validate status
      if (!["recording", "processing", "finished"].includes(status)) {
        return new Response(
          JSON.stringify({ error: "Invalid status. Must be: recording, processing, or finished" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      let targetConversationId = conversation_id;

      // If no conversation_id provided, get the latest conversation
      if (!targetConversationId) {
        const { data: latestConversation, error: fetchLatestError } = await supabaseClient
          .from("conversations")
          .select("conversation_id")
          .order("timestamp", { ascending: false })
          .limit(1)
          .single();

        if (fetchLatestError || !latestConversation) {
          return new Response(
            JSON.stringify({ error: "No existing conversations found to update" }),
            {
              status: 404,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }

        targetConversationId = latestConversation.conversation_id;
      }

      // Get current timestamp
      const timestamp = Math.floor(Date.now() / 1000);

      // Update or insert conversation
      // Upsert will insert if the conversation_id doesn't exist, or update if it does
      const { error: upsertError } = await supabaseClient
        .from("conversations")
        .upsert(
          {
            conversation_id: targetConversationId,
            status,
            timestamp,
          },
          {
            onConflict: "conversation_id",
            ignoreDuplicates: false, // Ensure updates happen when record exists
          }
        );

      if (upsertError) {
        throw upsertError;
      }
    } else if (conversation_id) {
      // If only conversation_id is provided without status, return error
      return new Response(
        JSON.stringify({ error: "Status is required when conversation_id is provided" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch all conversations ordered by timestamp (latest first)
    const { data: conversations, error: fetchError } = await supabaseClient
      .from("conversations")
      .select("conversation_id, timestamp, status")
      .order("timestamp", { ascending: false });

    if (fetchError) {
      throw fetchError;
    }

    // Format response
    const response: ConversationResponse[] = conversations.map((conv) => ({
      conversation_id: conv.conversation_id,
      timestamp: conv.timestamp,
      status: conv.status,
    }));

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});