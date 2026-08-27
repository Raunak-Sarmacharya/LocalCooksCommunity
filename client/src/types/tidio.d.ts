// Tidio Chat Widget Type Definitions
// https://developers.tidio.com/docs/widget-other-methods

interface TidioChatApi {
  open: () => void;
  close: () => void;
  show: () => void;
  hide: () => void;
  display: (show: boolean) => void;
  setVisitorData: (data: { distinct_id?: string; email?: string; name?: string }) => void;
  on: (event: TidioEvent, callback: () => void) => void;
  off: (event: TidioEvent, callback: () => void) => void;
}

type TidioEvent =
  | "ready"
  | "open"
  | "close"
  | "conversationStart"
  | "conversationEnd"
  | "messageFromVisitor"
  | "messageFromOperator";

interface Window {
  tidioChatApi?: TidioChatApi;
}

interface Document {
  tidioIdentify?: {
    distinct_id?: string;
    email?: string;
    name?: string;
  };
}
