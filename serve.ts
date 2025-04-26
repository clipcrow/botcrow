import { Application, Router } from "jsr:@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI } from "npm:@google/genai";
import type { ExecuteWebhookRequest } from "./type.ts";

await load({ export: true });
const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY") });

const router = new Router();
router.get("/", async (ctx) => {
  const req: ExecuteWebhookRequest = await ctx.request.body.json();
  console.log(req);

  const result = await ai.models.generateContent({
    model: "gemini-2.0-flash-lite",
    contents: req.message.message.message,
  });
  console.log(result);

  ctx.response.body = { message: result.text, message_type: "text" };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
await app.listen({ port: 8080 });
