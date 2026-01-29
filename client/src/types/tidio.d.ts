// Tidio Chat Widget Type Definitions
// Global type declarations for Tidio Chat API

export interface TidioChatApi {
  open: () => void;
  close: () => void;
  show: () => void;
  hide: () => void;
  display: (show: boolean) => void;
  setVisitorData: (data: { distinct_id?: string; email?: string; name?: string }) => void;
  on: (event: TidioEvent, callback: () => void) => void;
  off: (event: TidioEvent, callback: () => void) => void;
}

export type TidioEvent = 
  | "ready"
  | "open"
  | "close"
  | "conversationStart"
  | "conversationEnd"
  | "messageFromVisitor"
  | "messageFromOperator";

declare global {
  interface Window {
    tidioChatApi?: TidioChatApi;
    tidioIdentify?: {
      distinct_id?: string;
      email?: string;
      name?: string;
    };
  }
}
