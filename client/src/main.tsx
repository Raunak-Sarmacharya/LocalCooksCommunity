// CRITICAL: Sentry must be imported BEFORE all other modules for auto-instrumentation
import './instrument';
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
