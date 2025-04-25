export type ExecuteWebhookRequest = {
  action: string;
  message: {
    message: {
      message: string;
    };
  };
  metadata: {
    event: string;
    event_payload: {
      reaction_id: string;
      answer: string;
      question: string;
    };
  };
  target_object: object;
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
};

export type ExecuteWebhookResponse = {
  form_item_data: object;
  message: string;
  message_type: string;
  metadata: object;
};
