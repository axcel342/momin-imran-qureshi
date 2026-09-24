/** Rough OpenAI-style estimate (~4 chars/token); used only by the mock. */
export const estimateTokens = (text: string): number => Math.max(1, Math.ceil(text.length / 4));
