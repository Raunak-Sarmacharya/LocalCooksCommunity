import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyCMVWXnkwdnYzM15wNMulXTc4IeapW-pjs",
  authDomain: "locomay-45259.firebaseapp.com",
  projectId: "locomay-45259",
  storageBucket: "locomay-45259.firebasestorage.app",
  messagingSenderId: "113454441789",
  appId: "1:113454441789:web:9c18ba13321be5e8b7d154"
};

const app = initializeApp(firebaseConfig);
export const storage = getStorage(app);