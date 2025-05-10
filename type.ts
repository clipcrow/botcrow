export type Message = {
  id: string;
  created_at: string;
  message: string;
};

export type Bot = {
  id: string;
  name: string;
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

export type Actor = {
  bot?: Bot;
  member?: User;
};

export type Context = {
  messages: {
    actor: Actor;
    message: Message;
    mentions?: [];
  }[];
};

export type ExecuteWebhookRequest = {
  action: string;
  workspace: {
    id: string;
    name: string;
  };
  external_link: {
    id: string;
    name: string;
  };
  user: User;
  message: {
    message: Message;
  };
  context: Context;
  metadata?: object;
};

export type ExecuteWebhookResponse = {
  message: string;
  message_type: "text";
  metadata?: object;
};
