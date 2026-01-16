import { Application, Router } from "@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI, mcpToTool } from "@google/genai";
import type { ExecuteWebhookRequest } from "./type.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

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

  if (req.action === "MCP_SYNC") {
    const { endpoint, token } = req.bot.mcp;
    
    console.log("[Info] Starting MCP Sync with SDK (StreamableHTTP)...");

    // 1. Setup Transport with Auth Header
    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        // StreamableHTTPClientTransport supports requestInit for custom headers
        requestInit: {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        }
    });

    const client = new Client(
        { name: "botcrow-client", version: "1.0.0" },
        { capabilities: {} }
    );

    try {
        await client.connect(transport);

        // 2. List Tools
        const result = await client.listTools();
        const tools = result.tools;

        // Use SDK helper to convert MCP tools to Gemini tools
        // deno-lint-ignore no-explicit-any
        const geminiTools = tools.map((tool: any) => mcpToTool(tool));

        // 3. Gemini Loop
        // deno-lint-ignore no-explicit-any
        const historyRequest: any[] = [
            {
              role: "user",
              parts: [{
                  text: `MCP設定同期ボタンがクリックされました。
                  シリアル番号が ${req.bot.serial_no} のチャットに同期された旨のメッセージを書き出してください。`,
              }],
            },
        ];

        const maxTurns = 5;
        for (let i = 0; i < maxTurns; i++) {
            const result = await ai.models.generateContent({
              model: "gemini-2.5-flash",
              // mcpToTool returns a Tool object compliant with the SDK, so pass it directly
              // @ts-ignore: SDK types might differ slightly in Deno vs Node for mcpToTool return
              config: { tools: geminiTools },
              contents: historyRequest,
            });
    
            const calls = result.functionCalls;
            // if (result.text) console.log(result.text);
            
            if (!calls || calls.length === 0) break;
    
            historyRequest.push({
                role: "model",
                parts: result.candidates?.[0]?.content?.parts || [],
            });
    
            const functionResponses = [];
            for (const call of calls) {
                if (!call.name) {
                    console.warn(`[Warn] Skipping unnamed tool call:`, call);
                    continue;
                }
                // console.log(`[Info] Calling tool: ${call.name}`);
                try {
                    // Execute tool via SDK
                    const toolResult = await client.callTool({
                        name: call.name,
                        arguments: call.args || {},
                    });
    
                    functionResponses.push({
                        name: call.name,
                        response: { name: call.name, content: toolResult }
                    });
                } catch (e) {
                    console.error(`[Error] Tool execution failed for ${call.name}:`, e);
                    functionResponses.push({
                        name: call.name,
                        response: { error: String(e) }
                    });
                }
            }
    
            historyRequest.push({
                role: "function",
                parts: functionResponses.map(resp => ({ functionResponse: resp }))
            });
        }

    } catch (e) {
        console.error("[Error] MCP Sync failed:", e);
    } finally {
        // SDK connection cleanup if necessary
    }

    ctx.response.status = 200;
    return;
  }

  if (req.action === "REACT_BOT_MESSAGE") {
    ctx.response.body = {
      text: `リアクション（ ${req.reaction?.emoji} ）されました。`,
    };
    return;
  }

  if (req.action === "GUEST_USER_CHAT") {
    ctx.response.body = {
      text: `BOTへの質問は、[${req.bot.name}]をメンションに加えてください。`,
    };
    return;
  }

  const model = "gemini-2.5-flash";
  const systemInstruction = 
    "Be clear and short, don't try to answer everything at once," + 
    " and try to keep the conversation going with your users."; 
  let result;

  if (req.history && req.history.length > 0) {
    const history = req.history.map((h) => ({
      role: h.actor.type === "BOT" ? "model" : "user",
      parts: [{ text: h.text }],
    }));
    const chat = ai.chats.create({
      model,
      history,
      config: { systemInstruction },
    });
    result = await chat.sendMessage({
      message: req.current.text,
    });
  } else {
    result = await ai.models.generateContent({
      model,
      contents: req.current.text,
      config: { systemInstruction },
    });
  }

  const text = result.text;
  if (text) {
    console.log(text);
    ctx.response.body = { text };
  } else {
    ctx.response.status = 200;
  }
});

/*
router.post("/log", (ctx) => {
  console.log(ctx.request.body.json());
  ctx.response.status = 200;
});
*/

const app = new Application();
app.use(router.routes());
app.use(router.allowedMethods());
await app.listen({ port: 8080 });
