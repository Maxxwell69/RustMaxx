/**
 * Environment variable validation for RustMaxx services.
 * Use loadEnv() at startup; it throws if required vars are missing.
 */

export type EnvSchema = {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  SESSION_SECRET?: string;
  GATEWAY_SECRET?: string;
  GATEWAY_PORT?: string;
  API_PORT?: string;
};

const requiredForWeb = ["DATABASE_URL", "SESSION_SECRET"] as const;
const requiredForApi = ["DATABASE_URL", "API_PORT"] as const;
const requiredForGateway = ["GATEWAY_SECRET", "GATEWAY_PORT"] as const;

export function loadEnv(section: "web" | "api" | "gateway"): EnvSchema {
  const schema: EnvSchema = {
    NODE_ENV: process.env.NODE_ENV,
    DATABASE_URL: process.env.DATABASE_URL,
    SESSION_SECRET: process.env.SESSION_SECRET,
    GATEWAY_SECRET: process.env.GATEWAY_SECRET,
    GATEWAY_PORT: process.env.GATEWAY_PORT,
    API_PORT: process.env.API_PORT,
  };

  const required =
    section === "web"
      ? requiredForWeb
      : section === "api"
        ? requiredForApi
        : requiredForGateway;

  const missing = required.filter((key) => {
    const value = schema[key as keyof EnvSchema];
    return value === undefined || String(value).trim() === "";
  });

  if (missing.length > 0) {
    throw new Error(
      `Missing required env for ${section}: ${missing.join(", ")}`
    );
  }

  return schema;
}

export function getOptional(key: string): string | undefined {
  return process.env[key];
}

export function getOptionalInt(key: string): number | undefined {
  const v = process.env[key];
  if (v === undefined) return undefined;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}
