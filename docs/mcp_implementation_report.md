# MCP実装レポート: Gemini SDK統合と最適化

## 1. 概要

本ドキュメントでは、Model Context Protocol (MCP) と Gemini API を、公式
`@modelcontextprotocol/sdk` および Google GenAI SDK
を用いて統合した際の実装詳細について報告します。 Denoベースのサーバー
(`serve.ts`)
において、アップストリームのMCPサーバーと同期し、ツール群をGemini向けに変換し、チャットコンテキスト内で確実に実行させるための手法を確立しました。

## 2. 技術スタック

- **ランタイム**: Deno
- **フレームワーク**: Oak (Middleware)
- **AI SDK**: `@google/genai` (v1.37.0)
- **MCP SDK**: `@modelcontextprotocol/sdk` (v1.0.1)
- **トランスポート**: `StreamableHTTPClientTransport` (SSE compatible)

## 3. 主な課題と解決策

### 3.1. スキーマ互換性の問題 ("Too Many States" エラー)

**課題**: 標準の `mcpToTool` 変換や生のスキーマをそのままGemini
APIに渡すと、`400 INVALID_ARGUMENT` ("The specified schema produces a constraint
that has too many states for serving")
エラーが発生しました。これは20個以上のツールのスキーマが累積的に複雑すぎること（深いネスト、`anyOf`/`oneOf`
の多用、長文の説明文など）が原因でした。

**解決策**: **「焦土作戦 (Scorched Earth)」的スキーマ軽量化戦略**
を実装しました。

1. **手動マッピング**: `mcpToTool`
   の使用を中止し、完全に制御可能な独自のマッピング処理を実装しました。
2. **重要ツールの最適化 (ホワイトリスト)**:
   - **選別**: `Send_message` や `Get_*`
     系の重要ツールにのみ、完全な（ただし整形済みの）スキーマを適用しました。
   - **スタブ化**: それ以外のツールは
     `{ type: "object" }`（空のスキーマ）に簡略化しました。これにより、モデルにツールの存在は伝えつつ、状態空間を劇的に削減しました。
3. **積極的なクリーニング**:
   - **複合型の削除**: `allOf`, `anyOf`, `oneOf` を再帰的に全て削除しました。
   - **メタデータの削除**: `title`, `default`, `examples`, `format`, `pattern`
     などの不要フィールドを削除しました。
   - **説明文の圧縮**: ツールの `description`
     を150文字以内に切り詰め、改行を削除しました。**プロパティの `description`
     は全削除**しました。
   - **Enumの文字列化**: すべての Enum 値を文字列型に強制変換しました。

### 3.2. ツール実行とターゲット解決の失敗

**課題**: モデルが `Send_message` を呼び出す際、"record not found" や "invalid
UUID" エラーが発生しました。

- _原因1_: モデルがUUIDではなくシリアル番号（整数）を誤って使用していた。
- _原因2_: Bot ID（Card/Record ID）に対して `target_type: chats`
  を指定していた。

**解決策**:

1. **プロンプトエンジニアリング**:
   - プロンプト内で `req.bot.id` (UUID) を明示的に提示しました。
   - Botはシステム上「Card」であるため、ターゲットタイプとして `records`（または
     `external_links`）を指定するよう文言を修正しました。
2. **検索ツールの公開**: 必要に応じてモデルが自力でIDを検索できるよう、`Get_*`
   系のツールもホワイトリストに追加し、スキーマを公開しました。

### 3.3. 無限ループ

**課題**:
`mode: "ANY"`（強制ツール実行）を設定していたため、会話が終了すべき局面でもモデルが無理やりツールを呼び続け、ループが発生しました。
**解決策**: スキーマ問題が解決した後、モードを
`mode: "AUTO"`（デフォルト）に戻しました。これにより、モデルは適切にテキスト回答を行って会話を終了できるようになりました。

## 4. 最終的な実装詳細

簡略化された `serve.ts` のロジックフローは以下の通りです：

```typescript
// 1. SDK経由で接続
const client = new Client(...);
await client.connect(transport);

// 2. ツールの取得とスキーマ最適化
const tools = await client.listTools();
const geminiTools = tools.map(tool => {
  if (isCritical(tool)) {
    return convertAndCleanSchema(tool); // 積極的なクリーニング
  } else {
    return { name, parameters: { type: "object" } }; // 軽量スタブ
  }
});

// 3. コンテンツ生成
const result = await ai.models.generateContent({
  tools: [{ functionDeclarations: geminiTools }],
  config: { toolConfig: { functionCallingConfig: { mode: "AUTO" } } }
});

// 4. 実行とループ
if (result.functionCalls) {
  // MCP Client経由で実行
  const output = await client.callTool(...);
  // 結果をモデルにフィードバック...
}
```

## 5. 結論

システムは現在安定して稼働しています。**SDKベースのトランスポート**による信頼性と、**積極的な手動スキーマ最適化**によるAPI適合性の組み合わせにより、大規模なツールセットを持つMCPサーバーに対しても、Gemini
APIの制約内で確実にアクション（メッセージ送信など）を実行できるようになりました。
