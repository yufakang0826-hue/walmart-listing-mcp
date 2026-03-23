export function serializeSuccess(value: unknown): { content: [{ type: "text"; text: string }] } {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
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

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    const payload = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...((error as unknown) as Record<string, unknown>),
    };
    return JSON.stringify(payload, null, 2);
  }

  return JSON.stringify({ message: String(error) }, null, 2);
}
