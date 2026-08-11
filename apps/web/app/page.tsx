import { HOME_HEADING, buildHomeSubheading } from "@/lib/content";

export default function HomePage() {
  return (
    <main>
      <h1>{HOME_HEADING}</h1>
      <p>{buildHomeSubheading(new Date())}</p>
    </main>
  );
}
