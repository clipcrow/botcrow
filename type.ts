/**
 * カードの項目
 * @property name - 項目のタイトル
 * @property value - 値のテキスト表記。UIでは秘匿された項目もWebHookでは秘匿しない
 */
export type Property = {
  name: string;
  value: string;
};

/**
 * BOTとの送信と受信の両方で用いられるカードの内容
 * @property name - カードのタイトルもしくは姓名
 * @property description - カードの説明文章。ボットがプロンプトに組み込む
 * @property properties - カードの情報項目と報告項目全てをテキスト表示する
 * @property serial_no - カードの通し番号
 */
export type CardBody = {
  name: string;
  description?: string;
  properties?: Property[];
  serial_no: number;
};

/**
 * ClipCrowでカードとして表現される様々なオブジェクト
 * @property type - カードの種類
 *  - WORKSPACE - ワークスペース
 *  - CARD - タスクや連絡などユーザーが作成したもの
 *  - USER - ユーザー。管理者もしくはスタッフ
 *  - GUEST - ゲストユーザー
 *  - BOT - BOTアカウント
 *  - TEMPLATE - テンプレート
 *  - TAG - タググループ
 *  - BROWSER - 組み込みブラウザで登録されたチャット
 *  - SETTING - 設定トップ画面のチャット。ワークスペース設定、ナビゲーション設定など
 * @property id - カードへAPIでアクセスする際に用いるためのID
 */
export type Card = CardBody & {
  type:
    | "WORKSPACE"
    | "CARD"
    | "USER"
    | "GUEST"
    | "BOT"
    | "TEMPLATE"
    | "TAG"
    | "BROWSER"
    | "SETTING";
  id: string;
};

/**
 * 絵文字リアクションの情報
 * @property emoji - 絵文字テキスト
 * @property count - メッセージに追加されている数
 */
export type Reaction = {
  emoji: string;
  count: number;
};

/**
 * BOTとの送信と受信の両方で用いられるメッセージの内容
 * @property text - 書き込むメッセージ
 * @property metadata - BOT側で自由に利用できるメッセージの隠された情報
 * @property serial_no - メッセージがスレッドへの返答のとき、スレッドにつけられた通し番号を示す
 */
export type MessageBody = {
  text: string;
  metadata?: object;
  serial_no?: number;
};

/**
 * ClipCrowからWebHook送信する際に追加記述されるメッセージの詳細情報
 * @property id - メッセージやActionログへAPIでアクセスする際に用いるためのID
 * @property created_at - メッセージの作成日時
 * @property actor - メッセージの作者であるユーザーもしくはBOTの情報
 * @property reactions - メッセージに付加された絵文字リアクションの情報
 */
export type Message = MessageBody & {
  id: string;
  created_at: string;
  actor: Card;
  reactions?: Reaction[];
};

/**
 * WebHookの発生理由を示すアクションタイプ
 * - MENTION - BOTを明示的にメンションしたとき
 * - THREAD - MENTIONによって作られたスレッド内で、会話の続きとしてメンションなしで書き込まれたとき
 * - GUEST_USER_CHAT - ゲスト側チャットのトップレベルでメンションなしで書き込まれたとき
 * - REACT_BOT_MESSAGE - BOTによる書き込みにリアクションが追加されたとき
 * - MCP_SYNC - MCP設定同期ボタンがクリックされたとき
 * - OPEN_VIEW - 組み込みブラウザでビューを開くリクエスト。HTMLを返す。
 */
export type ExecuteWebhookAction =
  | "MENTION"
  | "THREAD"
  | "GUEST_USER_CHAT"
  | "REACT_BOT_MESSAGE"
  | "MCP_SYNC"
  | "OPEN_VIEW";

/**
 * ClipCrowからBOTのエンドポイントへ送信されるWebHookのペイロード
 * アクションによってペイロードの構造が変化する
 * @property action - WebHookの発生理由
 * @property bot - WebHookが送信されたBOTの情報
 * @property reaction - 今回のWebHookを送信したリアクションの絵文字(REACT_BOT_MESSAGEのみ)
 * @property history - スレッド内の会話の過去履歴(MENTION/THREAD/GUEST_USER_CHATのみ)
 * @property current - 今回のWebHookを送信したメッセージ
 * @property card - チャットが所属するカードの情報
 * @property workspace - チャットが所属するワークスペースの情報
 */
export type ExecuteWebhookRequest<
  A extends ExecuteWebhookAction = ExecuteWebhookAction
> = A extends "MENTION" | "THREAD" | "GUEST_USER_CHAT"
  ? {
      action: A;
      bot: Card;
      history?: Message[];
      current: Message;
      card: Card;
      workspace: Card;
    }
  : A extends "REACT_BOT_MESSAGE"
  ? {
      action: A;
      bot: Card;
      reaction: {
        emoji: string;
        actor: Card;
      };
      current: Message;
      card: Card;
      workspace: Card;
    }
  : A extends "MCP_SYNC"
  ? {
      action: A;
      bot: Card & {
        mcp: {
          endpoint: string;
          token: string;
        };
      };
      workspace: Card;
    }
  : A extends "OPEN_VIEW"
  ? {
      action: A;
      card: Card;
      workspace: Card;
    }
  : never;

/**
 * BOTが作るWebHookの返信内容。
 * Actionによって期待される返信が異なる。
 * - MENTION / THREAD / GUEST_USER_CHAT: MessageBody (メッセージ返信)
 * - REACT_BOT_MESSAGE / MCP_SYNC: null (返信なし)
 * - OPEN_VIEW: string (HTMLコンテンツ)
 */
export type ExecuteWebhookResponse<
  A extends ExecuteWebhookAction = ExecuteWebhookAction
> = A extends "MENTION" | "THREAD" | "GUEST_USER_CHAT"
  ? MessageBody
  : A extends "REACT_BOT_MESSAGE"
  ? null
  : A extends "MCP_SYNC"
  ? null
  : A extends "OPEN_VIEW"
  ? string
  : never;
