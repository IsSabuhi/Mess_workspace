import { Toaster } from "sonner";

import { useTheme } from "../context/ThemeContext";

/** Глобальные уведомления (успех / ошибка). */
export function AppToaster() {
  const { resolved } = useTheme();
  return (
    <Toaster
      theme={resolved}
      position="top-right"
      richColors
      closeButton
      toastOptions={{
        classNames: {
          toast: "font-sans",
        },
      }}
    />
  );
}
