import { createRoot } from "react-dom/client";
import { applyTheme, loadTheme } from '@/components/ThemePicker';
import posthog from "posthog-js";
import App from "./App.tsx";
import "./index.css";
import { UserPrefsProvider } from "./lib/UserPrefsContext";
import { ErrorBoundary } from "./components/ErrorBoundary";
import UpdateChecker from "./components/UpdateChecker";
import { startProblemLog } from "./lib/problemLog";

posthog.init("phc_udVxe34hMTHqcfzkfPno3idfPZGS7NeFwVGG9PgNT4t6", {
  api_host: "https://us.i.posthog.com",
  person_profiles: "identified_only",
  capture_exceptions: true,
  // Off in PostHog's settings for now. If it is turned on, nothing typed and
  // no photo of a stub goes with it.
  session_recording: {
    maskAllInputs: true,
    blockSelector: "img",
  },
});

startProblemLog();

applyTheme(loadTheme());

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <UserPrefsProvider>
      <UpdateChecker />
      <App />
    </UserPrefsProvider>
  </ErrorBoundary>
);
