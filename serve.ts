import { Application, Router } from "jsr:@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI } from "npm:@google/genai";
import type { ExecuteWebhookRequest } from "./type.ts";

const env = await load();
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const router = new Router();
router.get("/", async (ctx) => {
  const req: ExecuteWebhookRequest = await ctx.request.body.json();

  const result = await ai.models.generateContent({
    model: "gemini-2.0-flash-lite",
    contents: req.message.message.message,
  });
  ctx.response.body = result.text;
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
await app.listen({ port: 8080 });
