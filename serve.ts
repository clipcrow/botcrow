import { Application, Router } from "@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI } from "@google/genai";
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

      // 2. Convert MCP tools to Gemini FunctionDeclarations manually
      // mcpToTool produces schemas that are too complex for Gemini serving (e.g. "too many states").
      // We manually map and aggressively clean the schema here.
      // deno-lint-ignore no-explicit-any
      const geminiTools = tools.map((tool: any) => {
          // Optimization: Only provide full schema for "Send_message" to avoid "too many states" error.
          // For other tools, provide a generic object schema to allow the model to see them but not enforce strict grammar.
          const isCriticalTool = tool.name === "Send_message" || tool.name.startsWith("Get_");

          if (!isCriticalTool) {
               return {
                   name: tool.name,
                   description: (tool.description || "").substring(0, 100),
                   parameters: { type: "object" }
               };
          }

          // Aggressive schema cleaner (only for critical tools)
          // Deep clone the input schema to avoid mutating the original
          const inputSchema = JSON.parse(JSON.stringify(tool.inputSchema));

          // deno-lint-ignore no-explicit-any
          const cleanGeminiSchema = (schema: any) => {
              if (!schema || typeof schema !== "object") return;
              
              // Delete unsupported fields and complex constraints
              const unsafeFields = [
                  'uniqueItems', 'format', 'pattern', 
                  'minLength', 'maxLength', 
                  'minimum', 'maximum', 
                  'exclusiveMinimum', 'exclusiveMaximum',
                  'multipleOf',
                  'title', 'default', 'examples',
                  'allOf', 'anyOf', 'oneOf' 
              ];
              for (const field of unsafeFields) {
                  if (Object.prototype.hasOwnProperty.call(schema, field)) {
                      delete schema[field];
                  }
              }
              
              // Remove property descriptions entirely to save "states"
              if (schema.description && typeof schema.description === 'string') {
                   delete schema.description;
              }
              
              // Fix Enums
              if (schema.enum && Array.isArray(schema.enum)) {
                  schema.enum = schema.enum.map(String);
                  schema.type = "string"; 
              }
              
              // Recursion
              if (schema.properties) {
                   for (const key in schema.properties) {
                       cleanGeminiSchema(schema.properties[key]);
                   }
              }
              if (schema.items) {
                  if (Array.isArray(schema.items)) {
                      if (schema.items.length > 0) {
                          const firstItem = schema.items[0];
                          cleanGeminiSchema(firstItem);
                          schema.items = firstItem; 
                      } else {
                          delete schema.items; 
                      }
                  } else {
                      cleanGeminiSchema(schema.items);
                  }
              }
              if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
                  cleanGeminiSchema(schema.additionalProperties);
              }
              if (schema.definitions) {
                  for (const key in schema.definitions) {
                      cleanGeminiSchema(schema.definitions[key]);
                  }
              }
              if (schema.$defs) {
                   for (const key in schema.$defs) {
                      cleanGeminiSchema(schema.$defs[key]);
                   }
              }
          };

          // Clean the input schema (this will remove nested descriptions)
          cleanGeminiSchema(inputSchema);
          
          // For the tool itself, keep a short description
          let description = tool.description || "";
          if (description.length > 150) {
              description = description.substring(0, 147) + "...";
          }
          // Remove newlines and excess whitespace which might add tokens
          description = description.replace(/\s+/g, ' ').trim();

          return {
              name: tool.name,
              description: description,
              // deno-lint-ignore no-explicit-any
              parameters: inputSchema as any
          };
      });

      console.log(`[Debug] Converted tools (Manual):`, JSON.stringify(geminiTools, null, 2));

      // 3. Gemini Loop
      // deno-lint-ignore no-explicit-any
      const historyRequest: any[] = [
        {
          role: "user",
          parts: [{
              text: `MCP設定同期ボタンがクリックされました。
              利用可能なツール（例: Send_message など）を使用して、以下のチャットに「同期が完了しました」というメッセージを送信してください。
              
              ターゲットID (target_id): ${req.bot.id}
              ターゲットタイプ (target_type): records
              シリアル番号: ${req.bot.serial_no}
              
              ※ target_id が分かる場合は必ず target_id を使用してください。`,
          }],
        },
      ];

      const maxTurns = 5;
      for (let i = 0; i < maxTurns; i++) {
        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          config: { 
            tools: [{ functionDeclarations: geminiTools }],
            // toolConfig: { functionCallingConfig: { mode: "AUTO" } } // Default to AUTO
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
          console.log(`[Info] Calling tool: ${call.name} with args:`, JSON.stringify(call.args));
          try {
            // Execute tool via SDK
            const toolResult = await client.callTool({
              name: call.name,
              arguments: call.args || {},
            });
            
            console.log(`[Info] Tool result:`, JSON.stringify(toolResult).substring(0, 200) + "...");

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
