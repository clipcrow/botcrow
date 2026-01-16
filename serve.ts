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
    
    // JSON-RPCリクエストを送信するヘルパー関数
    const rpcRequest = async (method: string, params?: unknown, id: number = 1, sessionId?: string) => {
      const url = new URL(endpoint);
      if (sessionId) {
        url.searchParams.set("sessionId", sessionId);
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json, text/event-stream",
      };
      if (sessionId) {
        headers["Mcp-Session-Id"] = sessionId;
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method,
          params,
          id,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`MCP request failed: ${response.status} ${response.statusText} - ${errorText}`);
      }
      return await response.json(); // notificationの場合はnullが返るかも？要確認だが今回はresponse.json()で統一
    };

    try {
      // Step 0: Session Establishment (Probe)
      console.log("Step 0: Establishing session via GET...");
      const connectResponse = await fetch(endpoint, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "text/event-stream",
        },
      });
      
      if (!connectResponse.ok) {
        console.error(`GET request failed: ${connectResponse.status} ${connectResponse.statusText}`);
         // Fallback or throw? Let's log and continue with random UUID for now if it fails, 
         // but detailed logs are key.
      } else {
        console.log("GET request successful. Headers:", JSON.stringify([...connectResponse.headers.entries()]));
        // SSEの場合はボディを少し読んでみる等の処理が必要だが、
        // まずはヘッダーに x-session-id などがないか、あるいはリダイレクトURLがないかを確認。
        // リクエストURL自体が変わっている可能性もある
        console.log("Response URL:", connectResponse.url);
      }

      // とりあえず独自のUUIDを使うが、GETレスポンスのURLに `?sessionId=` が付いている場合はそれを使う
      let sessionId: string = crypto.randomUUID();
      const responseUrl = new URL(connectResponse.url);
      if (responseUrl.searchParams.has("sessionId")) {
        sessionId = responseUrl.searchParams.get("sessionId")!;
        console.log(`Obtained sessionId from URL: ${sessionId}`);
      } else if (connectResponse.headers.has("x-session-id")) {
         sessionId = connectResponse.headers.get("x-session-id")!;
         console.log(`Obtained sessionId from header: ${sessionId}`);
      } else {
         console.log(`Using generated sessionId: ${sessionId}`);
      }

      // Step 0-1: initialize
      console.log("Step 0-1: Sending initialize...");
      const initParam = {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "botcrow-client", version: "1.0.0" },
      };
      // 試しに initialize には sessionId を送らず、レスポンスを確認みる（オプション）
      // いや、エラーが "Missing" なので送る必要がある。
      // ここではレスポンスを詳細にログ出力する
      const initMeta = await rpcRequest("initialize", initParam, 0, sessionId);
      console.log("Initialize Response:", JSON.stringify(initMeta, null, 2));

      // 0-2. notifications/initialized
      console.log("Step 0-2: Sending initialized notification...");
      await rpcRequest("notifications/initialized", {}, 1, sessionId);

      // Step 1: ツール定義の変換 (MCP -> Gemini)
      console.log("Step 1: Listing tools...");
      // deno-lint-ignore no-explicit-any
      const listResponse: any = await rpcRequest("tools/list", {}, 2, sessionId);
      // deno-lint-ignore no-explicit-any
      const tools: any[] = listResponse.result?.tools || [];
      
      // deno-lint-ignore no-explicit-any
      const geminiTools = tools.map((tool: any) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
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
