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
 */
export type CardBody = {
  name: string;
  description?: string;
  properties?: Property[];
};

/**
 * ClipCrowでカードとして表現される様々なオブジェクト
 * @property type - カードの種類
 *  - WORKSPACE - ワークスペース
 *  - CARD - タスクや連絡などユーザーが作成したもの
 *  - MANAGER - 管理者
 *  - STAFF - スタッフ
 *  - PARTNER - パートナー
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
    | "MANAGER"
    | "STAFF"
    | "PARTNER"
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
    | "LOCATION"
    | "IMAGE"
    | "CARD"
    | "PROPERTIES"
  ;
  value: string | Card | Property[];
};

/**
 * BOTとの送信と受信の両方で用いられるメッセージの内容
 * @property type - 固定で"MESSAGE"
 * @property text - 書き込むメッセージ
 * @property attachment - 書き込む画像・ロケーション・ログでの項目情報リストなど
 * @property metadata - BOT側で自由に利用できるメッセージの隠された情報
 */
export type MessageBody = {
  text: string;
  attachment?: Attachment;
  metadata?: object;
};

/**
 * Actionログに記載する操作種類を示す識別
 */
export type Operation =
  | "CREATE"
  | "EDIT"
  | "";

/**
 * ClipCrowからWebHook送信する際に追加記述されるメッセージの詳細情報
 * @property id - メッセージやActionログへAPIでアクセスする際に用いるためのID
 * @property created_at - メッセージの作成日時
 * @property actor - メッセージの作者であるユーザーもしくはBOTの情報
 * @property operation - Actionログに記載する操作種類。NOTIFICATIONの場合のみ
 * @property reactions - メッセージに付加された絵文字リアクションの情報
 */
export type Message = MessageBody & {
  id: string;
  created_at: string;
  actor: Card;
  operation?: Operation;
  reactions?: Reaction[];
};

export type Device = {
  type: "IOS" | "ANDROID" | "BROWSER";
  screen: "PHONE_S" | "PHONE" | "TABLET_S" | "TABLET" | "PC" | "PC_L" ;
  language: "en" | "ja" | "vi";
};

/**
 * ClipCrowからBOTのエンドポイントへ送信されるWebHookのペイロード
 * @property action - WebHookの発生理由。
 *  - NOTIFICATION - カードの変化について通知されるとき
 *  - MENTION - BOTを明示的にメンションしたとき
 *  - THREAD - MENTIONによって作られたスレッド内で、会話の続きとしてメンションなしで書き込まれたとき
 *  - GUEST_USER_CHAT - ゲスト側チャットのトップレベルでメンションなしで書き込まれたとき
 *  - REACT_BOT_MESSAGE - BOTによる書き込みにリアクションが追加されたとき
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
    | "NOTIFICATION"
    | "MENTION"
    | "THREAD"
    | "GUEST_USER_CHAT"
    | "REACT_BOT_MESSAGE";
  bot: Card;
  reaction?: {
    emoji: string;
    actor: Card;
  };
  history?: Message[];
  current: Message;
  card: Card;
  workspace: Card;
  device: Device;
};

/**
 * BOTが作るWebHookの返信内容。BOTが書き込まないときにはレスポンスボディを空白にする
 */
export type ExecuteWebhookResponse = MessageBody | null | undefined;

// ############ WebHookの送受信サンプル ############

export const SAMPLE_REQUEST: ExecuteWebhookRequest = {
  action: "MENTION",
  bot: {
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    name: "BOTCROW",
    type: "BOT",
  },
  current: {
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    created_at: "2025-05-10T06:19:58.859633Z",
    actor: {
      id: "af3619c9-8420-4f01-ad10-c117833d334e",
      name: "目黒 太郎",
      type: "MANAGER",
      properties: [{ name: "plate", value: "品川 399 あ 0000" }],
    },
    text: "東京から車でいける近場で、温泉が良い。",
  },
  card: {
    type: "CARD",
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    name: "general",
    description:
      "このチャットルームはワークスペース全体のコミュニケーションとチームへのアナウンス用です。",
  },
  workspace: {
    type: "WORKSPACE",
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    name: "奥沢自動車産業",
    description: "SUV専門、防犯装置取り付けなら都内施工数最多の当店へ",
  },
  device: {
    type: "IOS",
    screen: "PHONE",
    language: "ja",
  }
};

export const SAMPLE_RESPONSE: ExecuteWebhookResponse = {
  text: "箱根はいかがでしょうか。箱根は東京からも近く、温泉地として有名です。",
  attachment: {
    type: "LOCATION",
    value: "35.232290°N 139.105189°E",
  },
  metadata: {
    something_one: "12345678",
    something_two: 9999,
  },
};
