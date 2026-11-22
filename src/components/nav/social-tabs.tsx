import { TabLinks } from "@/components/ui/misc";

/** Behind the bell: Activity (friends and groups) and Notifications (for you). */
export function SocialTabs({ active, unread }: { active: "activity" | "notifications"; unread: number }) {
  return (
    <TabLinks
      className="mb-5 mt-2"
      items={[
        { label: "Activity", href: "/activity", active: active === "activity" },
        { label: unread > 0 ? `Notifications · ${unread > 99 ? "99+" : unread}` : "Notifications", href: "/notifications", active: active === "notifications" },
      ]}
    />
  );
}
