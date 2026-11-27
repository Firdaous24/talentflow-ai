import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Review captures of the phase 6 public screens, light and dark, in French.
// Writes PNG files to OUT_DIR (mount a host folder there). No account is created.
const base = process.env.APP_URL ?? "http://host.docker.internal:5173";
const out = process.env.OUT_DIR ?? "/out";
await mkdir(out, { recursive: true });
const screens = [
  { name: "welcome", path: "/welcome", heading: "Des décisions de recrutement qui s'appuient sur des preuves.", fullPage: true },
  { name: "role-choice", path: "/register", heading: "Quel espace voulez-vous ouvrir ?" },
  { name: "sign-up", path: "/register/candidate", heading: "Inscription candidat·e" },
  { name: "sign-in", path: "/login", heading: "Se connecter" },
];
const browser = await chromium.launch({ headless: true });
try {
  for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
    await context.addInitScript((value) => localStorage.setItem("talentflow-theme", value), theme);
    const page = await context.newPage();
    for (const screen of screens) {
      await page.goto(`${base}${screen.path}`);
      await page.getByRole("heading", { name: screen.heading, exact: true }).waitFor();
      if (screen.name === "sign-up") {
        await page.getByLabel("Adresse e-mail", { exact: true }).fill("juno.fictional@example.com");
        await page.getByLabel("Mot de passe", { exact: true }).fill("une phrase de passe fictive");
      }
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: `${out}/${screen.name}-${theme}.png`, fullPage: !!screen.fullPage });
    }
    await context.close();
  }
  console.log(`screenshots written to ${out}`);
} finally {
  await browser.close();
}
