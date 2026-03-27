import type { Request, Response, NextFunction } from "express";
import crypto from "crypto";

function generateRequestId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

export function requestLogger() {
  return function (req: Request, res: Response, next: NextFunction) {
    const incoming = req.header("x-request-id");
    const requestId = (typeof incoming === "string" && incoming.trim().length > 0)
      ? incoming.trim()
      : generateRequestId();

    (req as any).requestId = requestId;
    res.setHeader("x-request-id", requestId);

    const start = Date.now();
    const method = req.method;
    const path = req.originalUrl || req.url;

    console.log(`[${requestId}] --> ${method} ${path}`);

    res.on("finish", () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      console.log(`[${requestId}] <-- ${method} ${path} ${status} ${ms}ms`);
    });

    next();
  };
}
