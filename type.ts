export type ExecuteWebhookRequest = {
  action: string;
  message: {
    message: {
      message: string;
    };
  };
  user: {
    id: string;
    email: string;
    name: string;
    role: "MANAGER" | "STAFF" | "PARTNER" | "GUEST";
    tags: {
      tag_group_id: string;
      value: string;
    }[];
  };
  workspace: {
    id: string;
    name: string;
    description: string;
  };
  metadata?: object;
};

export type ExecuteWebhookResponse = {
  message: string;
  message_type: "text";
  metadata?: object;
};
