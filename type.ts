export type Message = {
  message: {
    created_at: string;
    message: string;
  };
};

export type User = {
  id: string;
  email: string;
  name: string;
  role: "MANAGER" | "STAFF" | "PARTNER" | "GUEST";
  tags: {
    tag_group_id: string;
    value: string;
  }[];
};

export type Context = {
  user: User;
  message: Message;
}[];

export type ExecuteWebhookRequest = {
  action: string;
  workspace: {
    id: string;
    name: string;
  };
  user: User;
  message: Message;
  context: Context;
  metadata?: object;
};

export type ExecuteWebhookResponse = {
  message: string;
  message_type: "text";
  metadata?: object;
};
