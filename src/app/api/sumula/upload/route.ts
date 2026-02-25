export const runtime = "nodejs";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";
import type { DocumentScope, MatchKey, SumulaDocumentUpsert } from "@/lib/sumula/types";

// Bucket must already exist in Supabase Storage (created manually in dashboard).
const STORAGE_BUCKET = "match-reports";
const DOC_TYPE = "FPF_SUMULA";
const SOURCE = "FPF";
const PARSER_VERSION = "v1";

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
    const sandboxMatchIdValue = formData.get("sandbox_match_id");
    const scopeValue = formData.get("scope");
    const fileValue = formData.get("file");

    const match_id = typeof matchIdValue === "string" ? matchIdValue.trim() : "";
    const sandbox_match_id = typeof sandboxMatchIdValue === "string" ? sandboxMatchIdValue.trim() : "";
    const requestedScope = typeof scopeValue === "string" ? scopeValue.trim().toUpperCase() : "";
    const scope: DocumentScope = requestedScope === "SANDBOX" ? "SANDBOX" : "PROD";
    const file = fileValue instanceof File ? fileValue : null;

    if (!file) {
      return NextResponse.json({ error: "file is required." }, { status: 400 });
    }

    if (scope === "PROD" && !match_id) {
      return NextResponse.json({ error: "match_id is required when scope=PROD." }, { status: 400 });
    }

    if (scope === "SANDBOX" && !sandbox_match_id) {
      return NextResponse.json({ error: "sandbox_match_id is required when scope=SANDBOX." }, { status: 400 });
    }

    if (file.type !== "application/pdf") {
      return NextResponse.json({ error: "Unsupported media type. Only application/pdf is accepted." }, { status: 415 });
    }

    const scopeId = scope === "PROD" ? match_id : sandbox_match_id;
    const match_key = `${scope}:${scopeId}` as MatchKey;
    const storage_path = `sumulas/${scope.toLowerCase()}/${scopeId}/${DOC_TYPE}.pdf`;
    const supabase = getSupabaseAdmin();
    const sha256 = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");

    const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storage_path, file, {
      upsert: true,
      contentType: "application/pdf",
    });

    if (uploadError) {
      throw new Error(uploadError.message);
    }

    const uploaded_at = new Date().toISOString();
    const payload: SumulaDocumentUpsert = {
      source: SOURCE,
      doc_type: DOC_TYPE,
      scope,
      match_id: scope === "PROD" ? match_id : null,
      sandbox_match_id: scope === "SANDBOX" ? sandbox_match_id : null,
      match_key,
      storage_bucket: STORAGE_BUCKET,
      storage_path,
      parser_version: PARSER_VERSION,
      sha256,
      uploaded_at,
    };

    const { error: upsertError } = await supabase.from("documents").upsert(payload, {
      onConflict: "source,doc_type,match_key",
    });

    if (upsertError) {
      throw new Error(upsertError.message);
    }

    return NextResponse.json(
      {
        ok: true,
        scope,
        match_id: payload.match_id,
        sandbox_match_id: payload.sandbox_match_id,
        match_key,
        storage_path,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected upload error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
