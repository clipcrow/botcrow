import { Application, Router } from "@oak/oak";
import { load } from "std/dotenv/mod.ts";
import { GoogleGenAI } from "@google/genai";
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
  console.log(req);

  if (req.action === "MCP_SYNC") {
    const { endpoint, token } = req.bot.mcp;
    
    let sessionId: string | undefined;

    // JSON-RPCリクエストを送信するヘルパー関数
    const rpcRequest = async (method: string, params?: unknown, id: number | null = 1, overrideSessionId?: string) => {
      const effectiveSessionId = overrideSessionId ?? sessionId;
      
      const url = new URL(endpoint);
      if (effectiveSessionId) {
        url.searchParams.set("sessionId", effectiveSessionId);
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json, text/event-stream",
      };
      if (effectiveSessionId) {
        headers["Mcp-Session-Id"] = effectiveSessionId;
      }

      const body: Record<string, unknown> = {
        jsonrpc: "2.0",
        method,
        params,
      };
      if (id !== null) {
        body.id = id;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      // DEBUG: Log correlation ID or Headers to find where session ID is coming from
      // console.log(`[${method}] Response Headers:`, JSON.stringify([...response.headers.entries()]));

      // 1. Check for Session ID in Headers
      const headerSessionId = response.headers.get("x-session-id") || response.headers.get("mcp-session-id");
      if (headerSessionId && headerSessionId !== sessionId) {
         console.log(`Captured Session ID from headers: ${headerSessionId}`);
         sessionId = headerSessionId;
      }
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MCP request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      const contentType = response.headers.get("content-type");
      if (contentType && contentType.includes("text/event-stream")) {
        const reader = response.body?.pipeThrough(new TextDecoderStream()).getReader();
        if (!reader) throw new Error("No body in SSE response");

        let buffer = "";
        let result = null;

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          
          buffer += value;
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          let currentEvent = "message";

          for (const line of lines) {
            if (line.trim() === "") continue;
            
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              console.log(`SSE Received [${currentEvent}]: ${dataStr}`);

              if (currentEvent === "endpoint") {
                 // Endpoint event usually contains the URL for future POSTs, often with sessionId
                 // dataStr might be a relative or absolute URL
                 try {
                    const uri = new URL(dataStr, endpoint); // resolve against base endpoint
                    if (uri.searchParams.has("sessionId")) {
                        const newSessionId = uri.searchParams.get("sessionId");
                        if (newSessionId && newSessionId !== sessionId) {
                            console.log(`Creating/Updating Session ID from SSE endpoint: ${newSessionId}`);
                            sessionId = newSessionId;
                        }
                    }
                 } catch (e) {
                    console.error("Failed to parse endpoint URL:", e);
                 }
              }

              try {
                const data = JSON.parse(dataStr);
                if (data.id === id) {
                  result = data;
                  // We found our result, but we might want to keep reading briefly or just return?
                  // If we break here, we might miss an 'endpoint' event if it comes after?
                  // Usually endpoint comes immediately. Let's return.
                  // But wait, if we consume the stream, does it close? 
                  // For now, let's assume we can return once we have the result.
                  return result;
                }
              } catch (_e) {
                // Not JSON or not our response
              }
            }
          }
        }
        
        if (result) return result;
        // For notifications (id === null), we might not expect a result with an ID.
        // If it's a notification, we can just return success or null if stream ends.
        if (id === null) return null; 

        throw new Error("Stream ended without JSON-RPC response");
      }
      
      // If it's a notification and we got a normal response body (not SSE)
      // We might expect empty body or valid JSON.
      // But usually notifications don't get a response.
      // If response body is empty, response.json() will fail.
      const text = await response.text();
      if (!text) return null;
      return JSON.parse(text);
    };

    try {
      // Step 0: Session Establishment (Probe) - SKIPPED (Fails with 400)
      // console.log(`Step 0: Establishing session via GET (Probe) to ${endpoint} (Token len: ${token?.length})`);
      // ... (Skipping GET)


      // Step 0-1: initialize
      console.log("Step 0-1: Sending initialize without sessionId...");
      const initParam = {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "botcrow-client", version: "1.0.0" },
      };
      
      // Pass undefined for sessionId
      const initMeta = await rpcRequest("initialize", initParam, 0, undefined);
      
      // Check if we got a session ID from the initialize response?
      // Since rpcRequest returns the JSON body, we might need to modify rpcRequest to return headers too 
      // if we want to capture it. But let's first see if it succeeds.
      console.log("Initialize Response:", JSON.stringify(initMeta, null, 2));

      // 0-2. notifications/initialized
      console.log("Step 0-2: Sending initialized notification...");
      await rpcRequest("notifications/initialized", {}, null, sessionId);

      // Step 1: ツール定義の変換 (MCP -> Gemini)
      console.log("Step 1: Listing tools...");
      // deno-lint-ignore no-explicit-any
      const listResponse: any = await rpcRequest("tools/list", {}, 2, sessionId);
      // deno-lint-ignore no-explicit-any
      const tools: any[] = listResponse.result?.tools || [];
      
      // Helper to remove unsupported keys like 'uniqueItems'
      // deno-lint-ignore no-explicit-any
      const cleanSchema = (schema: any): any => {
        if (!schema || typeof schema !== "object") return schema;
        if (Array.isArray(schema)) return schema.map(cleanSchema);
        
        const { uniqueItems: _uniqueItems, ...rest } = schema; // Remove uniqueItems
        
        // Fix: Convert enum values to strings
        if (rest.enum && Array.isArray(rest.enum)) {
          rest.enum = rest.enum.map((v: unknown) => String(v));
        }
        
        // Recursively clean properties and items
        for (const key in rest) {
          rest[key] = cleanSchema(rest[key]);
        }
        return rest;
      };

      // deno-lint-ignore no-explicit-any
      const geminiTools = tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        parameters: cleanSchema(tool.inputSchema),
      }));

      // Step 3: Gemini API 実行 (Function Calling)
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        config: {
          tools: [{ functionDeclarations: geminiTools }],
        },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `MCP設定同期ボタンがクリックされました。
                シリアル番号が ${req.bot.serial_no} のチャットに同期された旨のメッセージを書き出してください。`,
              },
            ],
          },
        ],
      });

      // Step 4: Function Call の処理
      const call = result.functionCalls?.[0];
      if (call) {
        console.log(`Calling tool: ${call.name} with args:`, call.args);
        await rpcRequest("tools/call", {
          name: call.name,
          arguments: call.args,
        }, 3, sessionId);
        console.log("MCP Sync completed successfully.");
      } else {
        console.warn("MCP Sync: No function call generated by Gemini.");
      }

    } catch (e) {
      console.error(e);
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
