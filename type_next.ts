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
 * ClipCrowでカードとして表現される様々なオブジェクト
 * @property type - カードの種類
 *  - WORKSPACE - ワークスペース
 *  - CARD - タスクや連絡などユーザーが作成したもの
 *  - BOT - BOTアカウント
 *  - MEMBER - 管理者・スタッフ・パートナー
 *  - GUEST - ゲストユーザー
 *  - TAG - タググループ
 *  - BROWSER - 組み込みブラウザで登録されたチャット
 *  - SETTING - 設定トップ画面のチャット。ワークスペース設定、ナビゲーション設定など
 * @property id - カードへAPIでアクセスする際に用いるためのID
 * @property name - カードのタイトルもしくは姓名
 * @property description - カードの説明文章。ボットがプロンプトに組み込む
 * @property properties - カードの情報項目と報告項目全てをテキスト表示する
 */
export type Card = {
  type:
    | "WORKSPACE"
    | "CARD"
    | "BOT"
    | "MEMBER"
    | "GUEST"
    | "TAG"
    | "BROWSER"
    | "SETTING";
  id: string;
  name: string;
  description?: string;
  properties?: Property[];
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
 * @property attachment - 書き込む画像・ロケーションなど。（現在は保留して、将来対応とする）
 * @property metadata - BOT側で自由に利用できるメッセージの隠された情報
 */
export type MessageBody = {
  text: string;
  /*
  attachment?: {
    media_type: string;
    value: string;
  };
  */
  metadata?: object;
};

/**
 * ClipCrowからWebHook送信する際に追加記述されるメッセージの詳細情報
 * @property id - メッセージへAPIでアクセスする際に用いるためのID
 * @property created_at - メッセージの作成日時
 * @property actor - メッセージの作者であるユーザーもしくはBOTの情報
 * @property reactions - メッセージに付加された絵文字リアクションの情報
 * @property text - メッセージ本文
 * @property attachment - 表示されている画像・ロケーションなど（現在は保留して、将来対応とする）
 * @property metadata - BOT側で以前に設定した情報
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
 * @property bot - WebHookが送信されたBOTの情報
 * @property reaction - 今回のWebHookを送信したリアクションの絵文字。REACT_BOT_MESSAGEの場合のみ
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
    | "REACT_BOT_MESSAGE";
  bot: Card;
  reaction?: string;
  history?: Message[];
  current: Message;
  card: Card;
  workspace: Card;
};

/**
 * BOTが作るWebHookの返信内容。BOTが書き込まないときにはレスポンスボディを空白にする
 */
export type ExecuteWebhookResponse = MessageBody | null;

// ############ WebHookの送受信サンプル ############

export const SAMPLE_REQUEST: ExecuteWebhookRequest = {
  action: "MENTION",
  bot: {
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    name: "BOTCROW",
    type: "BOT",
    properties: [{ name: "plate", value: "世田谷 300 も 9000" }],
  },
  history: [
    {
      id: "af3619c9-8420-4f01-ad10-c117833d334e",
      created_at: "2025-05-10T06:19:58.859633Z",
      actor: {
        id: "af3619c9-8420-4f01-ad10-c117833d334e",
        name: "目黒 太郎",
        type: "MEMBER",
      },
      text: "おすすめの旅行先をおしえてください。",
    },
    {
      id: "af3619c9-8420-4f01-ad10-c117833d334e",
      created_at: "2025-05-10T06:19:58.859633Z",
      actor: {
        id: "af3619c9-8420-4f01-ad10-c117833d334e",
        name: "BOTCROW",
        type: "BOT",
        properties: [{ name: "plate", value: "世田谷 300 も 9000" }],
      },
      text: "了解いたしました。もうすこし詳しく条件を教えて下さい。",
      metadata: {
        something_one: "12345678",
        something_two: 1111,
      },
    },
  ],
  current: {
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    created_at: "2025-05-10T06:19:58.859633Z",
    actor: {
      id: "af3619c9-8420-4f01-ad10-c117833d334e",
      name: "目黒 太郎",
      type: "MEMBER",
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
};

export const SAMPLE_RESPONSE: ExecuteWebhookResponse = {
  text: "箱根はいかがでしょうか。箱根は東京からも近く、温泉地として有名です。",
  /*
  attachment: {
    media_type: "location",
    value: "35.232290°N 139.105189°E",
  },
  */
  metadata: {
    something_one: "12345678",
    something_two: 9999,
  },
};
