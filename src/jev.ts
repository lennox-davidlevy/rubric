// The one place Rubric talks to Jev. A failed call, or answers the resolver
// cannot read, is an "error" resolution, never "no" or "nothing fits".
//
// This is a plain fetch to the HTTP API rather than the TypeSafe SDK: the
// SDK 0.7.0 reads response bodies in a way Bun does not support ("Body already
// used"), and the writing path wants one fast attempt, not retries. The SDK's
// types are still used for the questions and answers.

import {
  buildQuestions, buildState, detailQuestions, lookQuestions, MODEL, PART, partQuestion, refineQuestions, refineState, resolve, resolveRefine,
  type Answers, type Catalog, type PageKind, type Question, type Refined, type Resolution,
} from "./core/index.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 10_000;

type Request = { model: string; state: unknown; questions: Record<string, Question> };

export interface Asked {
  resolution: Resolution;
  // Kept so any result can be rerun and inspected. In two steps, the second
  // request and response are `then`.
  request: Request;
  response?: unknown;
  then?: { request: Request; response?: unknown; ms: number };
  model?: string;
  ms: number;
}

type Called = { ok: true; answers: Answers; model: string; body: unknown; ms: number } | { ok: false; message: string; body?: unknown; ms: number };

// When Rubric last spoke to Jev's host. A connection left idle is closed,
// and opening one again costs about 130 ms on the next call.
let lastUsed = 0;

// Opens the connection to Jev's host ahead of a call, so the first call after
// a while isn't the slow one: about 230 ms for a fresh connection, 100 ms for
// one already open. It sends no key and asks no question, so it is never a
// call to Jev, and it is skipped while the connection is likely still open.
export function warm(): void {
  if (Date.now() - lastUsed < 20_000) return;
  lastUsed = Date.now();
  void fetch(new URL("/", ENDPOINT), { method: "HEAD", signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then((r) => r.arrayBuffer())
    .catch(() => {});
}

async function call(request: Request, key: string): Promise<Called> {
  lastUsed = Date.now();
  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, message: `could not reach Jev: ${(err as Error).message}`, ms: performance.now() - started };
  }
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  const ms = performance.now() - started;
  if (!res.ok) {
    // Errors come as {"detail": "..."} or {"detail": {"message": "...", ...}}.
    const d = (typeof body === "object" && body !== null ? (body as { detail?: unknown }).detail : undefined) as unknown;
    const detail =
      typeof d === "string" ? d
      : typeof d === "object" && d !== null && typeof (d as { message?: unknown }).message === "string" ? (d as { message: string }).message
      : d !== undefined ? JSON.stringify(d)
      : text.slice(0, 200);
    return { ok: false, message: `could not reach Jev: HTTP ${res.status} ${detail}`, body, ms };
  }
  const { answers, model } = body as { answers: Answers; model: string };
  return { ok: true, answers, model, body, ms };
}

// One step: every question in one request, whose size grows with the
// catalog. Two steps: which part, then whether the top two fit and their
// settings, so both requests stay small whatever the catalog's size. The
// resolver reads the same answers either way.
export async function ask(
  catalog: Catalog, directive: string, page: PageKind, key = process.env.TYPESAFE_API_KEY, steps: 1 | 2 = 1,
): Promise<Asked> {
  const state = buildState(directive, page);
  const request: Request = { model: MODEL, state, questions: steps === 1 ? buildQuestions(catalog) : partQuestion(catalog) };
  const error = (message: string, ms: number, extra: Partial<Asked> = {}): Asked => ({ resolution: { outcome: "error", message }, request, ms, ...extra });
  if (!key) return error("could not reach Jev: TYPESAFE_API_KEY is not set", 0);

  const first = await call(request, key);
  if (!first.ok) return error(first.message, first.ms, first.body === undefined ? {} : { response: first.body });
  let answers = first.answers;
  let ms = first.ms;
  let then: Asked["then"];

  if (steps === 2) {
    const ranked = Object.entries(((answers[PART] as { probabilities?: Record<string, number> } | undefined)?.probabilities ?? {}))
      .filter(([name]) => Object.hasOwn(catalog.parts, name))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([name]) => name);
    const second: Request = { model: MODEL, state, questions: { ...detailQuestions(catalog, ranked), ...lookQuestions(catalog) } };
    const next = await call(second, key);
    ms += next.ms;
    then = { request: second, ...(next.body === undefined ? {} : { response: next.body }), ms: next.ms };
    if (!next.ok) return error(next.message, ms, { response: first.body, then });
    answers = { ...answers, ...next.answers };
  }

  try {
    return { resolution: resolve(answers, catalog), request, response: first.body, ...(then ? { then } : {}), model: first.model, ms };
  } catch (err) {
    return error(`could not read Jev's answers: ${(err as Error).message}`, ms, { response: first.body, ...(then ? { then } : {}) });
  }
}

export interface Refining {
  refined?: Refined;
  error?: string;
  request: Request;
  response?: unknown;
  model?: string;
  ms: number;
}

// The second pass: words after a pinned part's ":", asked only about that
// part's settings, in one small request.
export async function refine(
  catalog: Catalog, part: string, words: string, page: PageKind, key = process.env.TYPESAFE_API_KEY,
): Promise<Refining> {
  const request: Request = {
    model: MODEL,
    state: refineState(words, page, part, catalog.parts[part]!.description),
    questions: refineQuestions(catalog, part),
  };
  if (!key) return { error: "could not reach Jev: TYPESAFE_API_KEY is not set", request, ms: 0 };
  const res = await call(request, key);
  if (!res.ok) return { error: res.message, request, ...(res.body === undefined ? {} : { response: res.body }), ms: res.ms };
  try {
    return { refined: resolveRefine(res.answers, catalog, part), request, response: res.body, model: res.model, ms: res.ms };
  } catch (err) {
    return { error: `could not read Jev's answers: ${(err as Error).message}`, request, response: res.body, ms: res.ms };
  }
}
