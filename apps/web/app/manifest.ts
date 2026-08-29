import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KYOZAI",
    short_name: "KYOZAI",
    description: "資料を、教えられる教材へ。",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f4ee",
    theme_color: "#1f2937",
    lang: "ja",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
