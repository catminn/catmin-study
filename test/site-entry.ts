// 本地测试：假 AI 向量 + 假 Vectorize + 假的 Anthropic/OpenAI 流式接口
import base from "./entry";
const realFetch = globalThis.fetch;
function fakeStream(provider: string, text: string) {
  const enc = new TextEncoder();
  const parts = text.match(/.{1,4}/gsu) || [];
  const evs = provider === "anthropic"
    ? [{ type: "message_start", message: { usage: { input_tokens: 1200 } } }, ...parts.map((t) => ({ type: "content_block_delta", delta: { type: "text_delta", text: t } })), { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 300 } }]
    : [...parts.map((t) => ({ choices: [{ delta: { content: t } }] })), { choices: [{ delta: {}, finish_reason: "stop" }] }, { choices: [], usage: { prompt_tokens: 1000, completion_tokens: 200 } }];
  return new ReadableStream({ start(c) { for (const e of evs) c.enqueue(enc.encode("data: " + JSON.stringify(e) + "\n\n")); if (provider !== "anthropic") c.enqueue(enc.encode("data: [DONE]\n\n")); c.close(); } });
}
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input.url;
  if (url.startsWith("https://api.anthropic.com/") || url.startsWith("https://api.openai.com/")) {
    const body = JSON.parse(init.body);
    const prov = url.includes("anthropic") ? "anthropic" : "openai";
    const last = body.messages[body.messages.length - 1];
    const lastText = typeof last.content === "string" ? last.content : last.content.map((c: any) => c.text || "").join("");
    const hasImg = typeof last.content !== "string";
    const reply = lastText.includes("JSON") ? '```json\n{"ok":true,"n":3}\n```' : `你好，这是${prov}的${body.model}回答。${hasImg ? "收到图片。" : ""}`;
    return new Response(fakeStream(prov, reply), { headers: { "content-type": "text/event-stream" } });
  }
  return realFetch(input, init);
}) as typeof fetch;
export default base;
