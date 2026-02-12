export function parseRequestBody(requestBody: string): Record<string, any> {
  const params = new URLSearchParams(requestBody);
  const result: Record<string, any> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}
