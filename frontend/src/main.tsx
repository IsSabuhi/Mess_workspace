import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AppToaster } from "./components/AppToaster";
import { AuthProvider } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import { queryClient } from "./lib/queryClient";
import "sonner/dist/styles.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <App />
            <AppToaster />
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </StrictMode>,
);
