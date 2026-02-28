import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { ok, requireSuperAdmin, parseUploadForm, validateQuestionSetCsv } from "../_shared/questionSet.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return ok({ ok: true });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Use POST" }), { status: 400 });

  const context = await requireSuperAdmin(req);
  if (context instanceof Response) return context;

  const parsed = await parseUploadForm(req);
  if (parsed instanceof Response) return parsed;

  const validation = await validateQuestionSetCsv(parsed.csvFile, parsed.assetFiles, parsed.metadata.test_type);

  return ok({
    ok: true,
    metadata: parsed.metadata,
    validation,
  });
});
