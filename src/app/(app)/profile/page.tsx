import { redirect } from "next/navigation";
import { requireProfile } from "@/lib/data";

export default async function MyProfilePage() {
  const profile = await requireProfile();
  redirect(`/u/${profile.username}`);
}
