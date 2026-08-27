/**
 * Tidio widget client.
 *
 * Follows Tidio's documented Widget SDK:
 * - Identify via `document.tidioIdentify` before the script loads
 * - Custom launcher: hide() on close; show() + open() on user click
 * - Do not call close() inside a close listener (causes loops)
 *
 * @see https://developers.tidio.com/docs/widget-visitor-identification
 * @see https://help.tidio.com/hc/en-us/articles/5464856955932-Opening-the-Chat-Widget-from-a-custom-button-or-a-link
 * @see https://developers.tidio.com/docs/widget-other-methods
 */

const SCRIPT_ID = "tidio-chat-script";
const SCRIPT_SRC = "https://code.tidio.co/xttrfsraxgqfnetg9kbnxl2mppgex2fi.js";
const READY_EVENT = "tidioChat-ready";
const LOAD_TIMEOUT_MS = 20_000;

type TidioApi = NonNullable<Window["tidioChatApi"]>;

export interface TidioVisitorIdentity {
  distinct_id?: string;
  email?: string;
  name?: string;
}

let customLauncherBound = false;
let loadPromise: Promise<TidioApi> | null = null;

function getApi(): TidioApi | undefined {
  return window.tidioChatApi;
}

export function setTidioVisitorIdentity(identity: TidioVisitorIdentity): void {
  const next: TidioVisitorIdentity = {};
  if (identity.distinct_id) next.distinct_id = identity.distinct_id;
  if (identity.email) next.email = identity.email;
  if (identity.name) next.name = identity.name;
  if (!next.distinct_id && !next.email && !next.name) return;

  document.tidioIdentify = next;

  const api = getApi();
  if (api && typeof api.setVisitorData === "function") {
    api.setVisitorData(next);
  }
}

function injectWidgetScript(): void {
  if (document.getElementById(SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = SCRIPT_ID;
  script.src = SCRIPT_SRC;
  script.async = true;
  document.body.appendChild(script);
}

function waitForApi(): Promise<TidioApi> {
  const existing = getApi();
  if (existing && typeof existing.open === "function") {
    return Promise.resolve(existing);
  }

  if (loadPromise) return loadPromise;

  loadPromise = new Promise<TidioApi>((resolve, reject) => {
    let settled = false;
    let timeoutId = 0;

    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      document.removeEventListener(READY_EVENT, onReady);
      if (error) {
        loadPromise = null;
        reject(error);
      }
    };

    const onReady = () => {
      const api = getApi();
      if (!api || typeof api.open !== "function") {
        settle(new Error("Tidio widget loaded without an API"));
        return;
      }
      settle();
      resolve(api);
    };

    timeoutId = window.setTimeout(() => {
      settle(new Error("Tidio widget timed out while loading"));
    }, LOAD_TIMEOUT_MS);

    document.addEventListener(READY_EVENT, onReady);
  });

  return loadPromise;
}

function bindCustomLauncher(api: TidioApi): void {
  if (customLauncherBound) return;
  customLauncherBound = true;

  api.on("close", () => {
    api.hide();
  });
}

export async function openTidioChat(): Promise<void> {
  injectWidgetScript();
  const api = await waitForApi();
  bindCustomLauncher(api);
  api.show();
  api.open();
}

export function subscribeTidioOpenState(listener: (isOpen: boolean) => void): () => void {
  const onOpen = () => listener(true);
  const onClose = () => listener(false);
  let attached = false;

  const attach = () => {
    const api = getApi();
    if (!api || attached) return;
    attached = true;
    api.on("open", onOpen);
    api.on("close", onClose);
  };

  attach();
  document.addEventListener(READY_EVENT, attach);

  return () => {
    document.removeEventListener(READY_EVENT, attach);
    const api = getApi();
    if (!api || !attached) return;
    api.off("open", onOpen);
    api.off("close", onClose);
  };
}
