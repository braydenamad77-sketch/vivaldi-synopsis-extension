import { defineContentScript } from "wxt/utils/define-content-script";

import "../src/content/card.css";
import { startSynopsisContentScript } from "../src/content/inject-card";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  runAt: "document_idle",
  async main() {
    startSynopsisContentScript();
  },
});
