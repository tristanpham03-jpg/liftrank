import { redirect } from "next/navigation";

/**
 * Home is gone (training-first). Old links, bookmarks, and home-screen apps
 * installed when the start page was /home (iOS keeps that address) land on
 * Training, the main destination.
 */
export default function HomePage() {
  redirect("/training");
}
