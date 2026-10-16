import { devices, test } from "@playwright/test";
import { checkArt, openPicker } from "./exercise-art-checks";
import { signUp, username } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const { defaultBrowserType, ...se } = devices["iPhone SE"];
test.use({ ...se, browserName: "webkit", viewport: { width: 320, height: 568 } });

test("Exercise pictures on a 320 px iPhone", async ({ page }) => {
  test.skip(!process.env.E2E_IOS_AUDIT, "Run with E2E_IOS_AUDIT=1 (needs WebKit installed).");
  await signUp(page, username("artse"));
  await checkArt(page);
  await page.screenshot({ path: "test-results/exercise-art/se-about.png" });
  await page.goto("/lift/new");
  await openPicker(page);
  await page.screenshot({ path: "test-results/exercise-art/se-picker.png" });
});
