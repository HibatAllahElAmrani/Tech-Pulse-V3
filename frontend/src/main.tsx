import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { AppDataProvider } from "./api/AppDataProvider";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <AppDataProvider>
        <App />
      </AppDataProvider>
    </ThemeProvider>
  </React.StrictMode>,
);
