// The one place Rubric talks to Jev. A failed call, or answers the resolver
// cannot read, is an "error" resolution, never "no" or "nothing fits".
//
// This is a plain fetch to the HTTP API rather than the TypeSafe SDK: the
// SDK 0.7.0 reads response bodies in a way Bun does not support ("Body already
// used"), and the writing path wants one fast attempt, not retries. The SDK's
// types are still used for the questions and answers.

import { buildQuestions, buildState, MODEL, resolve, type Answers, type Catalog, type PageKind, type Resolution } from "./core/index.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;

export interface Asked {
  resolution: Resolution;
  // Kept so any result can be rerun and inspected.
  request: { model: string; state: unknown; questions: unknown };
  response?: unknown;
  model?: string;
  ms: number;
}

export async function ask(catalog: Catalog, directive: string, page: PageKind, key = process.env.TYPESAFE_API_KEY): Promise<Asked> {
  const request = { model: MODEL, state: buildState(directive, page), questions: buildQuestions(catalog) };
  const started = performance.now();
  const error = (message: string, response?: unknown): Asked => ({
    resolution: { outcome: "error", message }, request, ...(response === undefined ? {} : { response }), ms: performance.now() - started,
  });
  if (!key) return error("could not reach Jev: TYPESAFE_API_KEY is not set");

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return error(`could not reach Jev: ${(err as Error).message}`);
  }

  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  const ms = performance.now() - started;
  if (!res.ok) {
    const detail = typeof body === "object" && body !== null && "detail" in body ? JSON.stringify(body.detail) : text.slice(0, 200);
    return error(`could not reach Jev: HTTP ${res.status} ${detail}`, body);
  }

  const { answers, model } = body as { answers: Answers; model: string };
  try {
    return { resolution: resolve(answers, catalog), request, response: body, model, ms };
  } catch (err) {
    return { ...error(`could not read Jev's answers: ${(err as Error).message}`, body), ms };
  }
}
