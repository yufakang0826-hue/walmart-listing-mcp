export function serializeSuccess(value: unknown): {
  content: [{ type: "text"; text: string }];
  structuredContent?: Record<string, unknown>;
} {
  const text = JSON.stringify(value, null, 2);
  const structuredContent = toStructured(value);
  return {
    content: [{ type: "text", text }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  };
}

function toStructured(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  if (typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return { result: value };
}

export function serializeError(error: unknown): { content: [{ type: "text"; text: string }]; isError: true } {
  return {
    content: [
      {
        type: "text",
        text: formatError(error),
      },
    ],
    isError: true,
  };
}

const SENSITIVE_KEY_PATTERN = /(secret|password|token|authorization|access[_-]?key|api[_-]?key|client[_-]?secret)/i;
const REDACTED = "[REDACTED]";

function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return "[truncated]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        result[key] = REDACTED;
      } else {
        result[key] = redactValue(val, depth + 1);
      }
    }
    return result;
  }
  if (typeof value === "string" && value.length > 1_000) {
    return `${value.slice(0, 1_000)}...[truncated]`;
  }
  return value;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const extras: Record<string, unknown> = {};
    for (const key of Object.keys(error) as Array<keyof typeof error>) {
      if (key === "stack" || key === "name" || key === "message") {
        continue;
      }
      extras[key] = redactValue((error as unknown as Record<string, unknown>)[key]);
    }
    const payload = {
      name: error.name,
      message: error.message,
      ...extras,
    };
    return JSON.stringify(payload, null, 2);
  }

  return JSON.stringify({ message: String(error) }, null, 2);
}
