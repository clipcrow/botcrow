export type Card = {
  id: string;
  name: string;
  description?: string;
  properties?: {
    name: string;
    value: string;
  }[];
};

export type Actor = Card & {
  type: "BOT" | "USER";
};

export type Reaction = {
  id: string;
  count: number;
};

export type MessageBody = {
  text: string;
  attachment?: {
    media_type: string;
    value: string;
  };
  metadata?: object;
};

export type Message = MessageBody & {
  id: string;
  created_at: string;
  actor: Actor;
  reactions?: Reaction[];
};

export type ExecuteWebhookRequest = {
  action: "MENTION" | "THREAD" | "GUEST_USER_CHAT" | "REACT_BOT_MESSAGE";
  target: Actor;
  messages: Message[];
  reaction?: Reaction;
  card: Card;
  workspace: Card;
};

export type ExecuteWebhookResponse = MessageBody;

export const SAMPLE_REQUEST: ExecuteWebhookRequest = {
  action: "MENTION",
  target: {
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    name: "BOTCROW",
    type: "BOT",
    properties: [{ name: "plate", value: "世田谷 300 も 9000" }],
  },
  messages: [
    {
      id: "af3619c9-8420-4f01-ad10-c117833d334e",
      created_at: "2025-05-10T06:19:58.859633Z",
      actor: {
        id: "af3619c9-8420-4f01-ad10-c117833d334e",
        name: "目黒 太郎",
        type: "USER",
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
    {
      id: "af3619c9-8420-4f01-ad10-c117833d334e",
      created_at: "2025-05-10T06:19:58.859633Z",
      actor: {
        id: "af3619c9-8420-4f01-ad10-c117833d334e",
        name: "目黒 太郎",
        type: "USER",
      },
      text: "東京から車でいける近場で、温泉が良い。",
    },
  ],
  card: {
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    name: "general",
    description:
      "このチャットルームはワークスペース全体のコミュニケーションとチームへのアナウンス用です。",
  },
  workspace: {
    id: "af3619c9-8420-4f01-ad10-c117833d334e",
    name: "奥沢自動車産業",
    description: "SUV専門、防犯装置取り付けなら都内施工数最多の当店へ",
  },
};

export const SAMPLE_RESPONSE: ExecuteWebhookResponse = {
  text: "箱根はいかがでしょうか。箱根は東京からも近く、温泉地として有名です。",
  attachment: {
    media_type: "location",
    value: "35.232290°N 139.105189°E",
  },
  metadata: {
    something_one: "12345678",
    something_two: 9999,
  },
};
