import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative asset paths + hash routing = works on any static host/subpath.
  base: "./",
  plugins: [react(), tailwindcss()],
  server: { port: 5182 },
});
