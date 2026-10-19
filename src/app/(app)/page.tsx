import { redirect } from "next/navigation";

// There is no separate dashboard: campaigns are the home screen.
export default function Home() {
  redirect("/campaigns");
}
