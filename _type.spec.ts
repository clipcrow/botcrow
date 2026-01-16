/**
 * カードの項目
 * @property name - 項目のタイトル
 * @property value - 値のテキスト表記。UIでは秘匿された項目もWebHookでは秘匿しない
 * @property remove - 値を削除した変更の場合はTrueを設定する
 */
export type Property = {
  name: string;
  value: string;
  remove?: boolean;
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
  serial_no?: number;
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
 * メッセージの添付情報
 */
export type Attachment = {
  type:
    | "FILE"
    | "LOCATION"
    | "IMAGE"
    | "CARD"
    | "PROPERTIES";
  value: string | Card | Property[];
};

/**
 * BOTとの送信と受信の両方で用いられるメッセージの内容
 * @property text - 書き込むメッセージ
 * @property annotation - Actionログに記載された操作対象
 * @property attachment - 書き込む画像・ロケーション・ログでの項目情報リストなど
 * @property metadata - BOT側で自由に利用できるメッセージの隠された情報
 * @property serial_no - メッセージがスレッドへの返答のとき、スレッドにつけられた通し番号を示す
 */
export type MessageBody = {
  text: string;
  annotation?: string;
  attachment?: Attachment;
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
 * ClipCrowからBOTのエンドポイントへ送信されるWebHookのペイロード
 * @property action - WebHookの発生理由。
 *  - MENTION - BOTを明示的にメンションしたとき
 *  - THREAD - MENTIONによって作られたスレッド内で、会話の続きとしてメンションなしで書き込まれたとき
 *  - GUEST_USER_CHAT - ゲスト側チャットのトップレベルでメンションなしで書き込まれたとき
 *  - REACT_BOT_MESSAGE - BOTによる書き込みにリアクションが追加されたとき
 *  - LOG - カードの変化について通知されるとき
 * @property bot - WebHookが送信されたBOTの情報
 * @property reaction - 今回のWebHookを送信したリアクションの絵文字。REACT_BOT_MESSAGEの場合のみ
 *  - emoji - 絵文字テキスト
 *  - actor - リアクションを送信したユーザー
 * @property history - スレッド内の会話の過去履歴で、今回のWebHookを送信したメッセージは含まない
 * @property current - 今回のWebHookを送信したメッセージ
 * @property card - チャットが所属するカードの情報
 * @property workspace - チャットが所属するワークスペースの情報
 */
export type ExecuteWebhookRequest = {
  action:
    | "MENTION"
    | "THREAD"
    | "GUEST_USER_CHAT"
    | "REACT_BOT_MESSAGE"
    | "LOG";
  bot: Card;
  reaction?: {
    emoji: string;
    actor: Card;
  };
  history?: Message[];
  current: Message;
  card: Card;
  workspace: Card;
};

/**
 * BOTが作るWebHookの返信内容。BOTが書き込まないときにはレスポンスボディを空白にする
 */
export type ExecuteWebhookResponse = MessageBody | null | undefined;

// ############ WebHookの送受信サンプル ############

export const SAMPLE_REQUEST: ExecuteWebhookRequest = {
  action: "LOG",
  current: {
    id: "abcdefgh-1234-5678-jkmn-p9123current",
    created_at: "2025-07-30T09:00:00.000000Z",
    actor: {
      id: "af3619c9-8420-4f01-ad10-c117833d334e",
      serial_no: 28,
      name: "サンプルユーザー",
      type: "USER",
    },
    text: "編集",
    attachment: {
      type: "PROPERTIES",
      value: [
        { name: "削除した項目", value: "0001", remove: true },
        { name: "追加した項目", value: "0002" },
      ],
    },
  },
  bot: {
    type: "BOT",
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    serial_no: 44,
    name: "サンプルBOT",
  },
  card: {
    type: "CARD",
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    serial_no: 123,
    name: "サンプルカード",
    properties: [
      { name: "追加した項目", value: "0002" },
    ],
  },
  workspace: {
    type: "WORKSPACE",
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    name: "サンプルワークスペース",
  },
};
