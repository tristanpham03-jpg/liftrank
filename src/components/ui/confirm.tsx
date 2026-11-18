"use client";

import { AlertDialog } from "radix-ui";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type Options = { title: string; body: string; confirm: string; cancel?: string; danger?: boolean; alt?: string };
/** true = confirm, false = cancel, "alt" = the optional second choice (only when `alt` is given). */
type Answer = boolean | "alt";

/**
 * An in-app confirmation (instead of window.confirm): `const [dialog, ask] = useConfirm()`,
 * render `{dialog}`, then `if (await ask({...})) …`.
 */
export function useConfirm(): [React.ReactNode, (o: Options) => Promise<Answer>] {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<((ok: Answer) => void) | null>(null);
  const ask = useCallback(
    (o: Options) =>
      new Promise<Answer>((resolve) => {
        resolver.current = resolve;
        setOpts(o);
      }),
    [],
  );
  const close = (ok: Answer) => {
    resolver.current?.(ok);
    resolver.current = null;
    setOpts(null);
  };
  const dialog = (
    <AlertDialog.Root open={opts != null} onOpenChange={(open) => (open ? null : close(false))}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-[#05070c]/60 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-[22px] border border-white/10 bg-[#161b28]/95 p-5 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl outline-none">
          <AlertDialog.Title className="text-[19px] font-semibold tracking-[-0.01em]">{opts?.title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1.5 text-[15px] text-fg-2">{opts?.body}</AlertDialog.Description>
          <div className="mt-5 flex flex-col gap-2">
            <Button block variant={opts?.danger ? "danger" : "primary"} onClick={() => close(true)}>
              {opts?.confirm}
            </Button>
            {opts?.alt ? (
              <Button block variant="secondary" onClick={() => close("alt")}>
                {opts.alt}
              </Button>
            ) : null}
            <Button block variant="secondary" onClick={() => close(false)}>
              {opts?.cancel ?? "Cancel"}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
  return [dialog, ask];
}
