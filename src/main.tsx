import { createRoot } from "react-dom/client";
import posthog from "posthog-js";
import App from "./App.tsx";
import "./index.css";

posthog.init("phc_udVxe34hMTHqcfzkfPno3idfPZGS7NeFwVGG9PgNT4t6", {
  api_host: "https://us.i.posthog.com",
  person_profiles: "identified_only",
  capture_exceptions: true,
  session_recording: {
    maskAllInputs: false,
    maskInputOptions: { password: true },
  },
});

import { UserPrefsProvider } from "./lib/UserPrefsContext";

createRoot(document.getElementById("root")!).render(
  <UserPrefsProvider>
    <App />
  </UserPrefsProvider>
);
