import { Application, Router } from "@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI } from "@google/genai";
import type { ExecuteWebhookRequest } from "./type.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

await load({ export: true });
const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY") });
const signature = Deno.env.get("X_CLIPCROW_SIGNATURE") || null;

// In-memory storage for Deno Deploy support
let mcpCredentials: { endpoint: string; token: string } | null = null;

// Try to load raw credentials from file on startup (for local dev persistence)
try {
  const text = await Deno.readTextFile(".mcp-credentials.json");
  mcpCredentials = JSON.parse(text);
} catch {
  // Ignore missing file or permission errors
}

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
      requestInit: {
        headers: { "Authorization": `Bearer ${token}` },
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

      // 3. Convert MCP tools to Gemini FunctionDeclarations manually
      // mcpToTool produces schemas that are too complex for Gemini serving (e.g. "too many states").
      // We manually map and aggressively clean the schema here for compatibility.
      // deno-lint-ignore no-explicit-any
      const geminiTools = tools.map((tool: any) => {
          // Optimization: Only provide full schema for "Send_message" and "Get_*" tools.
          // For other tools, provide a generic object schema to reduce total schema state size.
          const isCriticalTool = tool.name === "Send_message" || tool.name.startsWith("Get_");

          if (!isCriticalTool) {
               return {
                   name: tool.name,
                   description: (tool.description || "").substring(0, 100).replace(/\s+/g, ' ').trim(),
                   parameters: { type: "object" }
               };
          }
        
          // Deep clone the input schema to avoid mutating the original
          const inputSchema = JSON.parse(JSON.stringify(tool.inputSchema));
          // deno-lint-ignore no-explicit-any
          const cleanGeminiSchema = (schema: any) => {
              if (!schema || typeof schema !== "object") return;
              
              // Standard unsupported fields in Gemini Function Calling
              const unsafeFields = [
                  'default', 'examples', 'title',
                  'minLength', 'maxLength', 
                  'pattern', 'format',
                  'oneOf', 'anyOf', 'allOf' // Simplified assumption: Server no longer sends these
              ];

              for (const field of unsafeFields) {
                  if (Object.prototype.hasOwnProperty.call(schema, field)) {
                      console.log(`Deleting unsafe field: ${tool.name} ${field}`);
                      delete schema[field];
                  }
              }

              // Description is allowed in standard Gemini tools, but if we want to be safe or strict:
              // For now, we keep it but ensure it's a string.
              if (schema.description && typeof schema.description !== 'string') {
                  delete schema.description;
              }
              
              // Recursively clean properties
              if (schema.properties) {
                   for (const key in schema.properties) {
                       cleanGeminiSchema(schema.properties[key]);
                   }
              }
              if (schema.items) {
                  if (Array.isArray(schema.items)) {
                      // deno-lint-ignore no-explicit-any
                      schema.items.forEach((item: any) => cleanGeminiSchema(item));
                  } else {
                      cleanGeminiSchema(schema.items);
                  }
              }
          };

          // Clean the input schema
          cleanGeminiSchema(inputSchema);
          
          // Truncate tool description
          let description = tool.description || "";
          if (description.length > 150) {
              description = description.substring(0, 147) + "...";
          }
          description = description.replace(/\s+/g, ' ').trim();

          return {
              name: tool.name,
              description: tool.description,
              // deno-lint-ignore no-explicit-any
              parameters: inputSchema as any
          };
      });

      // 4. Gemini Loop
      // deno-lint-ignore no-explicit-any
      const historyRequest: any[] = [
        {
          role: "user",
          parts: [{
              text: `MCP設定同期ボタンがクリックされました。
              利用可能なツール（例: Send_message など）を使用して、以下のチャットに「同期が完了しました」というメッセージを送信してください。
              ターゲット (シリアル番号): ${req.bot.serial_no}`,
          }],
        },
      ];

      const maxTurns = 5;
      for (let i = 0; i < maxTurns; i++) {
        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          config: { 
            tools: [{ functionDeclarations: geminiTools }],
          },
          contents: historyRequest,
        });

        const calls = result.functionCalls;
        if (!calls || calls.length === 0) break;

        historyRequest.push({
          role: "model",
          parts: result.candidates?.[0]?.content?.parts || [],
        });

        const functionResponses = [];
        for (const call of calls) {
          if (!call.name) continue;
          
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

    // Update in-memory credentials using the request data directly
    mcpCredentials = { endpoint: req.bot.mcp.endpoint, token: req.bot.mcp.token };
    
    // Try to save to file for local persistence (ignore errors on Deploy)
    try {
      await Deno.writeTextFile(
        ".mcp-credentials.json",
        JSON.stringify(mcpCredentials)
      );
      console.log("[Info] Saved MCP credentials to .mcp-credentials.json");
    } catch (e) {
      console.warn("[Warn] Failed to save persistence file (expected on Deno Deploy):", e);
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

  if ("history" in req && req.history && req.history.length > 0) {
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

router.get("/mcp-debug", async (ctx) => {
  try {
    // Rely on in-memory credentials directly
    if (!mcpCredentials || !mcpCredentials.endpoint || !mcpCredentials.token) {
       // Attempt reload from file if memory is empty (e.g. fresh start local)
       try {
          const text = await Deno.readTextFile(".mcp-credentials.json");
          mcpCredentials = JSON.parse(text);
       } catch {
          throw new Error("No credentials found. Please click 'MCP Sync' button first.");
       }
    }
    
    if (!mcpCredentials) throw new Error("Invalid credentials state.");

    const { endpoint, token } = mcpCredentials;

    const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: {
        headers: { "Authorization": `Bearer ${token}` },
      },
    });

    const client = new Client(
      { name: "botcrow-debugger", version: "1.0.0" },
      { capabilities: {} },
    );

    await client.connect(transport);
    const result = await client.listTools();
    const tools = result.tools;

    if (ctx.request.url.searchParams.get("format") === "json") {
      ctx.response.headers.set("Content-Type", "application/json");
      ctx.response.headers.set("Content-Disposition", 'attachment; filename="mcp_tools.json"');
      ctx.response.body = JSON.stringify(tools, null, 2);
      return;
    }

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>MCP Tools Debugger</title>
        <style>
          body { font-family: monospace; padding: 20px; background: #f0f0f0; }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
          pre { background: white; padding: 15px; border-radius: 5px; overflow-x: auto; border: 1px solid #ccc; }
          .btn { background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
          .btn:hover { background: #0056b3; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>MCP Tools Definition</h1>
          <a href="?format=json" class="btn">Download JSON</a>
        </div>
        <pre>${JSON.stringify(tools, null, 2)}</pre>
      </body>
      </html>
    `;
    
    ctx.response.headers.set("Content-Type", "text/html");
    ctx.response.body = html;

  } catch (e) {
    ctx.response.status = 500;
    ctx.response.body = `Error: ${e instanceof Error ? e.message : String(e)}. Please click 'MCP Sync' first.`;
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
