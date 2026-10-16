"use client";

import Link from "next/link";
import { Switch } from "radix-ui";
import { useState, useTransition } from "react";
import { GymBoardOptIn } from "@/components/gyms/gym-opt-in";
import { GymPicker } from "@/components/gyms/gym-picker";
import { Button } from "@/components/ui/button";
import { FormMessage, Hint, Input, Label, Textarea } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import type { Gym, LiftVisibility, MyProfile, ProfileVisibility, WeightUnit } from "@/lib/types";
import { deleteAccount, saveProfile, saveSettings } from "./actions";

type Msg = { tone: "error" | "success"; text: string } | null;

function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-[14px] bg-white/[0.06] border border-white/10 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex-1 rounded-[10px] py-2 text-sm font-semibold",
            value === o.value ? "pearl" : "text-fg-3 hover:text-fg-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <label htmlFor={id} className="text-fg">
        {label}
      </label>
      <Switch.Root
        id={id}
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-7 w-12 shrink-0 rounded-full bg-white/10 data-[state=checked]:bg-accent transition-colors"
      >
        <Switch.Thumb className="block h-6 w-6 translate-x-0.5 rounded-full bg-fg transition-transform data-[state=checked]:translate-x-[22px] data-[state=checked]:bg-accent-ink" />
      </Switch.Root>
    </div>
  );
}

export function SettingsForm({ profile, prExercises }: { profile: MyProfile; prExercises: { id: string; name: string }[] }) {
  const s = profile.settings;
  const [gym, setGym] = useState<Gym | null>(profile.primary_gym);
  const [displayName, setDisplayName] = useState(profile.display_name ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [unit, setUnit] = useState<WeightUnit>(profile.preferred_unit);
  const [profileVis, setProfileVis] = useState<ProfileVisibility>(profile.profile_visibility);
  const [defaultVis, setDefaultVis] = useState<LiftVisibility>(s.default_visibility);
  const [notify, setNotify] = useState({
    friendRequests: s.notify_friend_requests,
    passed: s.notify_passed,
    firstPlace: s.notify_first_place,
    groupJoins: s.notify_group_joins,
  });
  const [featured, setFeatured] = useState<string[]>(s.featured_exercise_ids ?? []);
  const [confirm, setConfirm] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [deleteMsg, setDeleteMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();

  function save() {
    setMsg(null);
    start(async () => {
      const a = await saveProfile({ displayName, bio, preferredUnit: unit, profileVisibility: profileVis });
      if (!a.ok) return setMsg({ tone: "error", text: a.error });
      const b = await saveSettings({
        defaultVisibility: defaultVis,
        notifyFriendRequests: notify.friendRequests,
        notifyPassed: notify.passed,
        notifyFirstPlace: notify.firstPlace,
        notifyGroupJoins: notify.groupJoins,
        featuredExerciseIds: featured,
      });
      setMsg(b.ok ? { tone: "success", text: "Settings saved." } : { tone: "error", text: b.error });
    });
  }

  return (
    <div className="space-y-10">
      <section className="space-y-5">
        <h2 className="text-lg font-semibold">Profile</h2>
        <div>
          <Label htmlFor="displayName">Name</Label>
          <Input id="displayName" value={displayName} maxLength={40} onChange={(e) => setDisplayName(e.target.value)} />
          <Hint>
            Your username is @{profile.username}.{" "}
            <Link href="/onboarding" className="tap underline underline-offset-4">
              Change it
            </Link>
          </Hint>
        </div>
        <div>
          <Label htmlFor="bio">Bio</Label>
          <Textarea id="bio" value={bio} maxLength={160} onChange={(e) => setBio(e.target.value)} />
        </div>
        <div>
          <Label>Who can see your bio and records</Label>
          <Segmented
            label="Profile visibility"
            value={profileVis}
            onChange={setProfileVis}
            options={[
              { value: "public", label: "Everyone" },
              { value: "friends", label: "Friends" },
              { value: "private", label: "Only me" },
            ]}
          />
          <Hint>Your name and username always show on leaderboards you appear on.</Hint>
        </div>
        {prExercises.length ? (
          <fieldset>
            <legend className="block text-sm font-medium text-fg-2 mb-1.5">Featured lifts (up to 6)</legend>
            <div className="flex flex-wrap gap-2">
              {prExercises.map((e) => {
                const on = featured.includes(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && featured.length >= 6}
                    onClick={() => setFeatured(on ? featured.filter((x) => x !== e.id) : [...featured, e.id])}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium disabled:opacity-40",
                      on ? "border-transparent pearl" : "border-white/10 text-fg-2",
                    )}
                  >
                    {e.name}
                  </button>
                );
              })}
            </div>
            <Hint>Featured lifts are listed first on your profile.</Hint>
          </fieldset>
        ) : null}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Gym</h2>
          <p className="mt-1 text-sm text-fg-3">Self-reported. Changes save right away.</p>
        </div>
        <GymPicker gym={profile.primary_gym} onChange={setGym} />
        {gym ? <GymBoardOptIn initial={profile.public_leaderboard_opt_in} /> : null}
        {profile.is_moderator ? (
          <p className="text-sm">
            <Link href="/moderation" className="text-fg-2 underline decoration-white/30 underline-offset-4 hover:text-fg">
              Open the moderation queue
            </Link>
          </p>
        ) : null}
      </section>

      <section className="space-y-5">
        <h2 className="text-lg font-semibold">Lifts</h2>
        <div>
          <Label>Units</Label>
          <Segmented label="Units" value={unit} onChange={setUnit} options={[{ value: "lb", label: "Pounds (lb)" }, { value: "kg", label: "Kilograms (kg)" }]} />
        </div>
        <div>
          <Label>New lifts are visible to</Label>
          <Segmented
            label="Default lift visibility"
            value={defaultVis === "groups" ? "public" : defaultVis}
            onChange={(v) => setDefaultVis(v)}
            options={[
              { value: "public", label: "Public" },
              { value: "friends", label: "Friends" },
              { value: "private", label: "Private" },
            ]}
          />
          <Hint>You can change this for any single lift next to Submit.</Hint>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Notifications</h2>
        <div className="divide-y divide-white/[0.06]">
          <Toggle id="n-friends" label="Friend requests" checked={notify.friendRequests} onChange={(v) => setNotify({ ...notify, friendRequests: v })} />
          <Toggle id="n-passed" label="Someone passes you" checked={notify.passed} onChange={(v) => setNotify({ ...notify, passed: v })} />
          <Toggle id="n-first" label="Someone takes your first place" checked={notify.firstPlace} onChange={(v) => setNotify({ ...notify, firstPlace: v })} />
          <Toggle id="n-joins" label="New members in groups you run" checked={notify.groupJoins} onChange={(v) => setNotify({ ...notify, groupJoins: v })} />
        </div>
      </section>

      <div className="sticky bottom-[calc(var(--nav-height)+var(--safe-bottom)+8px)] md:bottom-4 space-y-3">
        <FormMessage tone={msg?.tone}>{msg?.text}</FormMessage>
        <Button size="lg" block onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>

      <section className="space-y-4 border-t border-white/[0.07] pt-8">
        <h2 className="text-lg font-semibold">Account</h2>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="secondary" block>
            Sign out
          </Button>
        </form>
        <details className="rounded-[var(--radius-panel)] border border-danger/30 px-4 py-3">
          <summary className="cursor-pointer font-medium text-danger">Delete account</summary>
          <div className="mt-3 space-y-3">
            <p className="text-sm text-fg-2">
              This permanently deletes your profile, lifts, friends and notifications. Groups you own pass to another member, or are deleted
              if you’re the only one. Past group records stay, shown as “Deleted user”.
            </p>
            <div>
              <Label htmlFor="confirm">Type your username to confirm</Label>
              <Input id="confirm" value={confirm} autoCapitalize="none" onChange={(e) => setConfirm(e.target.value)} placeholder={profile.username ?? ""} />
            </div>
            <FormMessage tone={deleteMsg?.tone}>{deleteMsg?.text}</FormMessage>
            <Button
              variant="danger"
              block
              disabled={pending || confirm.trim().toLowerCase() !== profile.username}
              onClick={() =>
                start(async () => {
                  const res = await deleteAccount(confirm);
                  if (res && !res.ok) setDeleteMsg({ tone: "error", text: res.error });
                })
              }
            >
              Permanently delete my account
            </Button>
          </div>
        </details>
      </section>
    </div>
  );
}
