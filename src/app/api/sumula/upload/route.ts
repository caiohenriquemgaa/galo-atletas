export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";

// Bucket must already exist in Supabase Storage (created manually in dashboard).
const STORAGE_BUCKET = "match-reports";
const DOC_TYPE = "FPF_SUMULA";
const SOURCE = "FPF";

function isAuthorized(request: Request) {
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret !== null && headerSecret === process.env.CRON_SECRET;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const matchIdValue = formData.get("match_id");
    const fileValue = formData.get("file");

    const match_id = typeof matchIdValue === "string" ? matchIdValue.trim() : "";
    const file = fileValue instanceof File ? fileValue : null;

    if (!match_id || !file) {
      return NextResponse.json({ error: "match_id and file are required." }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Unsupported media type. Only application/pdf is accepted." }, { status: 415 });
    }

    const storage_path = `sumulas/${match_id}/${DOC_TYPE}.pdf`;
    const supabase = getSupabaseAdmin();

    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storage_path, file, {
      upsert: true,
      contentType: "application/pdf",
    });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const uploaded_at = new Date().toISOString();
    const { error: upsertError } = await supabase.from("documents").upsert(
      {
        source: SOURCE,
        doc_type: DOC_TYPE,
        match_id,
        storage_bucket: STORAGE_BUCKET,
        storage_path,
        uploaded_at,
      },
      { onConflict: "source,doc_type,match_id" }
    );

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    return NextResponse.json({ ok: true, match_id, storage_path }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
