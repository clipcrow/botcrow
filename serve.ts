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

      // デバッグ: セッションIDの取得元を特定するためのヘッダーログ出力
      // console.log(`[${method}] Response Headers:`, JSON.stringify([...response.headers.entries()]));

      // 1. ヘッダー内のセッションIDを確認
      const headerSessionId = response.headers.get("x-session-id") || response.headers.get("mcp-session-id");
      if (headerSessionId && headerSessionId !== sessionId) {
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
              
              if (currentEvent === "endpoint") {
                 // endpoint イベントには通常、将来のPOSTリクエスト用URLが含まれており、セッションIDが付与されていることが多い
                 // dataStr は相対URLまたは絶対URLの可能性がある
                 try {
                    const uri = new URL(dataStr, endpoint); // ベースエンドポイントに対して解決
                    if (uri.searchParams.has("sessionId")) {
                        const newSessionId = uri.searchParams.get("sessionId");
                        if (newSessionId && newSessionId !== sessionId) {
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
                  // 結果を取得できたため、終了する
                  // 本来はストリームを継続監視すべき場合もあるが、endpointイベント等は通常直後に来るため、ここでリターンする
                  return result;
                }
              } catch (_e) {
                // JSONでない、または対象外のレスポンス
              }
            }
          }
        }
        
        if (result) return result;
        // 通知 (id === null) の場合、ID付きの結果は期待されないため、ストリーム終了時にnullを返す
        if (id === null) return null; 

        throw new Error("Stream ended without JSON-RPC response");
      }
      
      // 通知リクエストで通常のレスポンスボディ（SSE以外）を受け取った場合
      // 空のボディまたは有効なJSONを想定
      // 通常、通知にはレスポンスがない
      // レスポンスボディが空の場合、response.json() は失敗するためテキストとして取得して確認する
      const text = await response.text();
      if (!text) return null;
      return JSON.parse(text);
    };

    try {
      // Step 0-1: 初期化 (セッション開始)
      // 注意: サーバーにセッションIDを割り当てさせるため、セッションID無しで initialize を送信する
      const initParam = {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "botcrow-client", version: "1.0.0" },
      };
      
      const _initMeta = await rpcRequest("initialize", initParam, 0, undefined);
      
      // 0-2. 初期化完了の通知 (notifications/initialized)
      await rpcRequest("notifications/initialized", {}, null, sessionId);

      // Step 1: ツールのリスト取得 (MCP -> Gemini)
      // deno-lint-ignore no-explicit-any
      const listResponse: any = await rpcRequest("tools/list", {}, 2, sessionId);
      // deno-lint-ignore no-explicit-any
      const tools: any[] = listResponse.result?.tools || [];
      
      // 'uniqueItems' などの非対応キーを削除し、Enum型を強制的に文字列にするヘルパー関数
      // deno-lint-ignore no-explicit-any
      const cleanSchema = (schema: any): any => {
        if (!schema || typeof schema !== "object") return schema;
        if (Array.isArray(schema)) return schema.map(cleanSchema);
        
        const { uniqueItems: _uniqueItems, ...rest } = schema;
        
        // Gemini向けの修正: Enumの値は文字列でなければならず、型も 'string' である必要がある
        if (rest.enum && Array.isArray(rest.enum)) {
          rest.enum = rest.enum.map((v: unknown) => String(v));
          rest.type = "string";
        }
        
        // プロパティとアイテムを再帰的にクリーニング
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

      // Step 3: Gemini ループ実行 (Function Calling)
      // deno-lint-ignore no-explicit-any
      const historyRequest: any[] = [
        {
          role: "user",
          parts: [
            {
              text: `MCP設定同期ボタンがクリックされました。
              シリアル番号が ${req.bot.serial_no} のチャットに同期された旨のメッセージを書き出してください。`,
            },
          ],
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
        
        // テキスト応答があればログ出力（最終応答の可能性がある）
        //if (result.text) {
             // console.log(result.text); 
        //}
        
        if (!calls || calls.length === 0) {
            break;
        }

        // モデルの応答（ツール呼び出し）を履歴に追加
        historyRequest.push({
            role: "model",
            parts: result.candidates?.[0]?.content?.parts || [],
        });

         // ツールを実行
         const functionResponses = [];
         for (const call of calls) {
            try {
                // deno-lint-ignore no-explicit-any
                const toolResult: any = await rpcRequest("tools/call", {
                    name: call.name,
                    arguments: call.args,
                }, 3, sessionId); // ツール呼び出しに固定ID '3' を使用（複数は紛らわしいかもしれないが、このスコープでは許容）

                functionResponses.push({
                    name: call.name,
                    response: {
                        name: call.name,
                        content: toolResult 
                    }
                });
            } catch (e) {
                console.error(`Tool execution failed for ${call.name}:`, e);
                functionResponses.push({
                    name: call.name,
                    response: { error: String(e) }
                });
            }
         }

         // 関数の実行結果を履歴に追加
         historyRequest.push({
             role: "function",
             parts: functionResponses.map(resp => ({
                 functionResponse: resp
             }))
         });
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
