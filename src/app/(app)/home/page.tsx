import { redirect } from "next/navigation";

/** Home was replaced by Progress (training-first). Old links and bookmarks land there. */
export default function HomePage() {
  redirect("/progress");
}
