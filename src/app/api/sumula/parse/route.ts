export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/serverAdmin";
import { parseToCanonical } from "@/lib/parsers/fpfReportParser";

type ParseStage =
  | "REQUEST"
  | "AUTH"
  | "LOAD_DOCUMENT"
  | "DOWNLOAD_PDF"
  | "PARSE_RAW"
  | "SAVE_RAW"
  | "SAVE_CANONICAL";

type ParseApiError = {
  code: string;
  message: string;
  stage: ParseStage;
  documentId?: string;
};

type ParseRequestBody = {
  documentId?: string;
};

type DocumentRow = {
  id: string;
  storage_bucket: string;
  storage_path: string;
};

function isAuthorized(request: Request) {
  const headerSecret = request.headers.get("x-cron-secret");
  return headerSecret !== null && headerSecret === process.env.CRON_SECRET;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function buildError(error: ParseApiError, status: number) {
  return NextResponse.json({ error }, { status });
}

async function extractPdfRawText(buffer: Buffer) {
  const pdfParse = (await import("pdf-parse")).default;
  const parsed = await pdfParse(buffer);
  const text = parsed.text?.trim();
  if (!text) {
    throw new Error("PDF text extraction returned empty content.");
  }
  return text;
}

function internalErrorPayload(stage: ParseStage, documentId: string | undefined): ParseApiError {
  return {
    code: "SUMULA_PARSE_INTERNAL_ERROR",
    message: `Parsing failed at stage ${stage}.`,
    stage,
    documentId,
  };
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return buildError(
      {
        code: "SUMULA_PARSE_UNAUTHORIZED",
        message: "Unauthorized",
        stage: "AUTH",
      },
      401
    );
  }

  let documentId: string | undefined;

  try {
    const body = (await request.json()) as ParseRequestBody;
    documentId = body?.documentId?.trim();

    if (!documentId || !isUuid(documentId)) {
      return buildError(
        {
          code: "SUMULA_PARSE_INVALID_INPUT",
          message: "documentId must be a valid UUID.",
          stage: "REQUEST",
          documentId,
        },
        400
      );
    }

    const supabase = getSupabaseAdmin();
    console.info("[sumula.parse] start", { documentId });

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id,storage_bucket,storage_path")
      .eq("id", documentId)
      .single<DocumentRow>();

    if (documentError || !document) {
      console.error("[sumula.parse] load-document-failed", {
        documentId,
        reason: documentError?.message ?? "not-found",
      });
      return buildError(
        {
          code: "SUMULA_PARSE_DOCUMENT_NOT_FOUND",
          message: "Document not found.",
          stage: "LOAD_DOCUMENT",
          documentId,
        },
        404
      );
    }

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from(document.storage_bucket)
      .download(document.storage_path);

    if (downloadError || !fileBlob) {
      console.error("[sumula.parse] download-failed", {
        documentId,
        reason: downloadError?.message ?? "download-returned-null",
      });
      return buildError(
        {
          code: "SUMULA_PARSE_DOWNLOAD_FAILED",
          message: "Could not download the source PDF from storage.",
          stage: "DOWNLOAD_PDF",
          documentId,
        },
        422
      );
    }

    const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());
    const rawText = await extractPdfRawText(pdfBuffer);

    const { error: saveRawError } = await supabase
      .from("documents")
      .update({
        raw_text: rawText,
        status: "PARSED_RAW",
        parse_error: null,
        parsed_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (saveRawError) {
      console.error("[sumula.parse] save-raw-failed", {
        documentId,
        reason: saveRawError.message,
      });
      return buildError(
        {
          code: "SUMULA_PARSE_SAVE_RAW_FAILED",
          message: "Failed to persist raw text.",
          stage: "SAVE_RAW",
          documentId,
        },
        500
      );
    }

    const canonical = parseToCanonical(rawText);

    const { error: saveCanonicalError } = await supabase
      .from("documents")
      .update({
        canonical_json: canonical,
        status: "CANONICAL",
        parse_error: null,
        canonical_at: new Date().toISOString(),
      })
      .eq("id", documentId);

    if (saveCanonicalError) {
      console.error("[sumula.parse] save-canonical-failed", {
        documentId,
        reason: saveCanonicalError.message,
      });
      return buildError(
        {
          code: "SUMULA_PARSE_SAVE_CANONICAL_FAILED",
          message: "Failed to persist canonical JSON.",
          stage: "SAVE_CANONICAL",
          documentId,
        },
        500
      );
    }

    console.info("[sumula.parse] completed", { documentId });
    return NextResponse.json(
      {
        ok: true,
        documentId,
        status: "CANONICAL",
        canonical_preview: {
          match_meta: canonical.match_meta,
          home_starters: canonical.lineups.home.starters.length,
          away_starters: canonical.lineups.away.starters.length,
          home_reserves: canonical.lineups.home.reserves.length,
          away_reserves: canonical.lineups.away.reserves.length,
          events_count: canonical.events.length,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const supabase = getSupabaseAdmin();
    const rawMessage = error instanceof Error ? error.message : "Unexpected parsing error.";
    const safeMessage = rawMessage.slice(0, 300);

    if (documentId) {
      await supabase
        .from("documents")
        .update({
          status: "ERROR",
          parse_error: safeMessage,
        })
        .eq("id", documentId);
    }

    console.error("[sumula.parse] unexpected-error", {
      documentId,
      reason: safeMessage,
    });

    return buildError(internalErrorPayload("PARSE_RAW", documentId), 500);
  }
}
