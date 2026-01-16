# MCP実装レポート: 知見とベストプラクティス

本ドキュメントは、`serve.ts` における MCP
同期ロジックの実装プロセスで得られた技術的な発見と成功パターンをまとめたものです。

## 1. セッションIDの取り扱い

**課題:** クライアント側で独自のUUIDを生成して送信したところ、`400 Bad Request`
("Missing session ID")
エラーが発生しました。サーバーは全ての操作でセッションIDを要求しますが、最初の接続確立時のみ挙動が異なることが判明しました。

**解決策:**

- **初期ハンドシェイク:**
  クライアント側でIDを生成せず、セッションIDを持たない状態で `initialize`
  (JSON-RPC) リクエストを送信します。
- **セッションIDの取得:**
  サーバーは初期化時にセッションIDを発行します。これらは以下のいずれかから取得可能です：
  - **レスポンスヘッダー:** `x-session-id` または `mcp-session-id`
    ヘッダーを確認する。
  - **SSE イベント:** レスポンスが SSE
    ストリームの場合（MCPでは一般的）、`endpoint` イベントを監視します。`data`
    ペイロードに含まれるURLのクエリパラメータ（例:
    `...?sessionId=...`）にIDが含まれています。
- **一貫した利用:** 取得したセッションIDは、その後の **すべての**
  リクエストにおいて `Mcp-Session-Id`
  ヘッダー（および必要に応じてクエリパラメータ）に含める必要があります。

## 2. Gemini スキーマの互換性

**課題:** Gemini API が MCP ツールの定義を `INVALID_ARGUMENT`
として拒否しました。特に `enum` 値と `uniqueItems`
プロパティに関するエラーが頻発しました。

**制約と修正:**

- **`uniqueItems` 非対応:** Gemini は JSON Schema の `uniqueItems`
  プロパティをサポートしていません。APIに送信する前に、ツール定義から再帰的に削除する必要があります。
- **Enum は文字列のみ:** Gemini では `enum`
  の値はすべて文字列である必要があります。数値の Enum（例:
  `estimated_time: [5, 10, 15]`）はエラーとなります。
  - **修正:** `enum` 配列内のすべての値を文字列に変換する（例:
    `["5", "10", "15"]`）。
  - **型指定:** `enum` が存在する場合、元のスキーマが `integer` や `number`
    であっても、明示的に `type: "string"` を強制する必要があります。

## 3. JSON-RPC 通知 (Notification)

**課題:** 通知エンドポイント（`notifications/initialized` など）に対して `id`
を含むリクエストを送信すると、「Invalid request」エラーが発生します。

**要件:** JSON-RPC 2.0 の仕様上、通知 (Notification) には `id`
メンバーを含めてはいけません。

- **実装:** `rpcRequest` ヘルパー関数を修正し、`id` パラメータに `null` または
  `undefined` が渡された場合は、ペイロードから `id`
  キー自体を削除するように実装する必要があります。

## 4. マルチターン関数呼び出し (Multi-Turn Function Calling)

**課題:** 単一の `generateContent` 呼び出しでは、複雑なワークフロー（情報の取得
→ その結果に基づくアクション）を完結できませんでした。 例:
「タグ番号で情報を検索」してから「メッセージを送信」する場合、1回目の呼び出しで終了してしまう。

**パターン:** ループ処理（例: 最大5ターン）を実装します：

1. 現在の履歴を `generateContent` に送信する。
2. `functionCalls` があるか確認する。
   - **ある場合:** MCP経由でツールを実行する。
   - **ない場合:**
     モデルのテキスト応答（完了メッセージ等）を処理してループを終了する。
3. **モデルの呼び出し** (role: `model`) と **ツールの実行結果** (role:
   `function`) の両方を会話履歴に追加する。
4. 更新された履歴を使って再度 `generateContent` を呼び出す。

## コード例: セッション管理付き RPC ヘルパー

```typescript
// ロジックの簡略版（参照用）
const rpcRequest = async (method, params, id, overrideSessionId) => {
  const effectiveSessionId = overrideSessionId ?? currentSessionId;
  // ヘッダーの設定
  if (effectiveSessionId) headers["Mcp-Session-Id"] = effectiveSessionId;

  const response = await fetch(url, ...);
  
  // ヘッダーからセッションIDをキャプチャ
  const headerId = response.headers.get("x-session-id");
  if (headerId) currentSessionId = headerId;

  // SSEイベントの 'endpoint' からもセッションIDを監視して更新する
  // ...
};
```
