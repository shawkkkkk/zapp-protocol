import { createHash } from "node:crypto";
import { database } from "./db";

export class RateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = "RateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function clientFingerprint(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const realIp = request.headers.get("x-real-ip") || "";
  const ip = forwarded.split(",")[0]?.trim() || realIp.trim() || "unknown";
  const secret = process.env.ZAPP_RATE_LIMIT_SECRET || "zapp-rate-limit-v1";
  return createHash("sha256").update(secret + "\0" + ip).digest("hex");
}

export async function enforceRateLimit(
  request: Request,
  input: {
    namespace: string;
    limit: number;
    windowSeconds: number;
    identity?: string | null;
  },
): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const startSeconds =
    Math.floor(nowSeconds / input.windowSeconds) * input.windowSeconds;
  const windowStart = new Date(startSeconds * 1000);
  const retryAfterSeconds = Math.max(
    1,
    startSeconds + input.windowSeconds - nowSeconds,
  );

  const fingerprint = clientFingerprint(request);
  const identity = input.identity?.trim() || "";
  const bucketKey = createHash("sha256")
    .update(
      [
        "ZAPP_RATE_V1",
        input.namespace,
        fingerprint,
        identity,
      ].join("\0"),
    )
    .digest("hex");

  const result = await database().query<{ hits: number }>(
    `INSERT INTO api_rate_limits(bucket_key,window_start,hits)
     VALUES ($1,$2,1)
     ON CONFLICT(bucket_key,window_start)
     DO UPDATE SET hits=api_rate_limits.hits+1
     RETURNING hits`,
    [bucketKey, windowStart],
  );

  const hits = Number(result.rows[0]?.hits || 0);
  if (hits > input.limit) {
    throw new RateLimitError(
      "Too many requests. Try again shortly.",
      retryAfterSeconds,
    );
  }

  if (hits === 1) {
    void database()
      .query(
        "DELETE FROM api_rate_limits WHERE window_start < NOW() - INTERVAL '2 days'",
      )
      .catch(() => {});
  }
}

export function rateLimitResponse(error: RateLimitError): Response {
  return Response.json(
    { error: error.message },
    {
      status: 429,
      headers: {
        "retry-after": String(error.retryAfterSeconds),
        "cache-control": "no-store",
      },
    },
  );
}
