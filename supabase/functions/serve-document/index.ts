import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id, session_id } = await req.json();

    if (!job_id || !session_id) {
      return new Response(
        JSON.stringify({ error: "Missing job_id or session_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Verify session
    const { data: job, error } = await supabaseAdmin
      .from("print_jobs")
      .select("*")
      .eq("id", job_id)
      .eq("session_id", session_id)
      .single();

    if (error || !job) {
      return new Response(
        JSON.stringify({ error: "Invalid session or job not found" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (job.printed) {
      return new Response(
        JSON.stringify({ error: "Document already printed" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new Date(job.expires_at) < new Date()) {
      return new Response(
        JSON.stringify({ error: "Print link expired" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch file from private storage
    const { data: fileData, error: downloadError } = await supabaseAdmin
      .storage
      .from("documents")
      .download(job.file_path);

    if (downloadError || !fileData) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch document" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Determine content type
    const ext = job.file_path.split(".").pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      pdf: "application/pdf",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
    };
    const contentType = contentTypes[ext || ""] || "application/octet-stream";

    return new Response(fileData, {
      headers: {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Disposition": "inline",
        "Cache-Control": "no-store, no-cache, must-revalidate",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
