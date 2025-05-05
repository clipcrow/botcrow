import { Application, Router } from "jsr:@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI, Part } from "npm:@google/genai";
import { Buffer } from "node:buffer";
import type { ExecuteWebhookRequest } from "./type.ts";

await load({ export: true });
const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY") });
const signature = Deno.env.get("X_CLIPCROW_SIGNATURE");

const embedded: Part[] = [];
for await (const entry of Deno.readDir("./pdf")) {
  embedded.push({
    inlineData: {
      mimeType: "application/pdf",
      data: Buffer.from(await Deno.readFile(`./pdf/${entry.name}`)).toString("base64"),
    } 
  });
  console.log(entry.name);
}

const router = new Router();
router.post("/", async (ctx) => {
  if (signature && signature !== ctx.request.headers.get("X-ClipCrow-Signature")) {
    ctx.response.status = 401;
    return;
  }

  const req: ExecuteWebhookRequest = await ctx.request.body.json();
  console.log(req);

  const result = await ai.models.generateContent({
    model: "gemini-2.0-flash-lite",
    contents: [ req.message.message.message, ...embedded ],
    config: {
      systemInstruction: "あなたはClipCrow製品サポートデスクの担当者です。",
    }
  });
  console.log(result);

  ctx.response.body = { message: result.text, message_type: "text" };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
await app.listen({ port: 8080 });
