import { Application, Router } from "jsr:@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI } from "npm:@google/genai";
import type { ExecuteWebhookRequest } from "./type.ts";

await load({ export: true });
const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY") });
const signature = Deno.env.get("X_CLIPCROW_SIGNATURE") || null;

const router = new Router();
router.post("/", async (ctx) => {
  if (signature !== ctx.request.headers.get("X-ClipCrow-Signature")) {
    ctx.response.status = 401;
    return;
  }

  const req: ExecuteWebhookRequest = await ctx.request.body.json();
  console.log(req.action);
  console.log(req.context);

  const history = req.context.messages.map((h) => {
    const name = h.actor.bot?.name || h.actor.member?.name;
    const { message, created_at} = h.message;
    return `[${created_at}] ${name} : ${message}`;
  });

  const prompt = `次の会話に続けて話してください。\n会話:\n${history.join("\n")}`;
  console.log(prompt);

  const result = await ai.models.generateContent({
    model: "gemini-2.0-flash-lite",
    contents: prompt,
    config: {
      systemInstruction: `あなたの名前は${req.external_link.name}です。`,
    },
  });
  console.log(result);

  ctx.response.body = { message: result.text, message_type: "text" };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
await app.listen({ port: 8080 });
