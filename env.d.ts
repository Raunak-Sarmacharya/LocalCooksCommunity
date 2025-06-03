/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Remove all VITE_FIREBASE_* properties
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
} 