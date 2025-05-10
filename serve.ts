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

  if (req.action === "REACT_BOT_MESSAGE") {
    ctx.response.status = 200;
    return;
  }

  if (req.action === "GUEST_USER_CHAT") {
    ctx.response.body = {
      message:
        `BOTへの質問は、[${req.external_link.name}]をメンションに加えてください。`,
      message_type: "text",
    };
    return;
  }

  const history = req.context.messages.map((h) => ({
    role: h.actor.bot ? "model" : "user",
    parts: [{ text: h.message.message }],
  }));
  const current = history.pop();

  const chat = ai.chats.create({
    history,
    model: "gemini-2.0-flash-lite",
  });
  const result = await chat.sendMessage({
    message: current!.parts[0].text,
  });
  console.log(result.text);

  ctx.response.body = { message: result.text, message_type: "text" };
});

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
await app.listen({ port: 8080 });
