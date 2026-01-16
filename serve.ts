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
          "Authorization": `Bearer ${token}`,
        },
      },
    });

    const client = new Client(
      { name: "botcrow-client", version: "1.0.0" },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);

      // 2. List Tools
      const result = await client.listTools();
      const tools = result.tools;
      console.log(`[Debug] Listed ${tools.length} tools from MCP server.`);

      // Use SDK helper to convert MCP tools to Gemini tools
      // deno-lint-ignore no-explicit-any
      const geminiTools = tools.map((tool: any) => {
          const geminiTool = mcpToTool(tool);
          // @ts-ignore: Accessing internal config property
          const config = geminiTool.config; // Extract config
          
          if (config?.inputSchema) {
              // deno-lint-ignore no-explicit-any
              const fixEnums = (schema: any) => {
                  if (!schema || typeof schema !== "object") return;
                  if (schema.enum && Array.isArray(schema.enum)) {
                      schema.enum = schema.enum.map(String);
                      schema.type = "string"; // Force type to string for enums
                  }
                  if (schema.properties) {
                       for (const key in schema.properties) {
                           fixEnums(schema.properties[key]);
                       }
                  }
                  if (schema.items) {
                      fixEnums(schema.items);
                  }
              };
              // @ts-ignore: config is internal
              fixEnums(config.inputSchema);
          }
          
          // Map to FunctionDeclaration structure expected by Gemini API
          return {
              // @ts-ignore: config is internal
              name: config.name,
              // @ts-ignore: config is internal
              description: config.description,
              // @ts-ignore: config is internal
              parameters: config.inputSchema // Rename inputSchema to parameters
          };
      });
      
      console.log(`[Debug] Converted tools:`, JSON.stringify(geminiTools, null, 2));

      // 3. Gemini Loop
      // deno-lint-ignore no-explicit-any
      const historyRequest: any[] = [
        {
          role: "user",
          parts: [{
              text: `MCP設定同期ボタンがクリックされました。
              利用可能なツール（例: send_message など）を使用して、シリアル番号が ${req.bot.serial_no} のチャットに、「同期が完了しました」という旨のメッセージを実際に送信してください。`,
          }],
        },
      ];

      const maxTurns = 5;
      for (let i = 0; i < maxTurns; i++) {
        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          config: { 
            tools: [{ functionDeclarations: geminiTools }],
            // @ts-ignore: "ANY" is a valid mode string at runtime
            toolConfig: { functionCallingConfig: { mode: "ANY" } } // Force tool usage
          },
          contents: historyRequest,
        });

        const calls = result.functionCalls;
        console.log(
          `[Debug] Turn ${i + 1}: Model generated ${
            calls?.length || 0
          } function calls.`,
        );
        if (result.text) console.log(`[Debug] Model thought:`, result.text);

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
              response: { name: call.name, content: toolResult },
            });
          } catch (e) {
            console.error(`[Error] Tool execution failed for ${call.name}:`, e);
            functionResponses.push({
              name: call.name,
              response: { error: String(e) },
            });
          }
        }

        historyRequest.push({
          role: "function",
          parts: functionResponses.map((resp) => ({ functionResponse: resp })),
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
