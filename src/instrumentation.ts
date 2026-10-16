/** Runs once when the server starts. Opt-in network diagnostics only (LR_NET_DEBUG=1). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.LR_NET_DEBUG === "1") {
    const { installNetDebug } = await import("./lib/net-debug");
    installNetDebug();
  }
}
