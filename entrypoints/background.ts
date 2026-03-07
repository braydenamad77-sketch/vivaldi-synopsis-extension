import { defineBackground } from "wxt/utils/define-background";

import { startBackground } from "../src/background/service-worker";

export default defineBackground(() => {
  startBackground();
});
