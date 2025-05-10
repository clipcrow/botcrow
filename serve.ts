import { Application, Router } from "jsr:@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI, GenerateContentResponse } from "npm:@google/genai";
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

  let result: GenerateContentResponse;
  if (req.context.messages.length == 1) {
    result = await ai.models.generateContent({
      model: "gemini-2.0-flash-lite",
      contents: [req.message.message.message],
    });
  } else {
    const chat = ai.chats.create({
      model: "gemini-2.0-flash-lite",
      history: req.context.messages.map((h) => ({
        role: h.actor.bot ? "model" : "user",
        parts: [{ text: h.message.message.message }],
      })),
    });
    result = await chat.sendMessage({
      message: req.message.message.message,
    });
  }
  console.log(result);

  ctx.response.body = { message: result.text, message_type: "text" };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
await app.listen({ port: 8080 });
