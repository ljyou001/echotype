import React from "react";
import { createRoot } from "react-dom/client";
import "./i18n/config";
import App from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

console.log("Starting React app...");

try {
  createRoot(container).render(<App />);
  console.log("React app rendered successfully");
} catch (error) {
  console.error("Failed to render React app:", error);
  document.body.innerHTML = `<div style="color: red; padding: 20px;">Error: ${error}</div>`;
}
