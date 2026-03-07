import { defineWebExtConfig } from "wxt";

const home = process.env.HOME ?? "";

export default defineWebExtConfig({
  binaries: {
    chrome: "/Applications/Vivaldi.app/Contents/MacOS/Vivaldi",
  },
  chromiumProfile: `${home}/Library/Application Support/Vivaldi`,
  chromiumArgs: ["--profile-directory=Default"],
  keepProfileChanges: true,
});
