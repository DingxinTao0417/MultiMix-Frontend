export function assertPaidE2EAllowed({ suite, env = process.env, args = process.argv.slice(2) }) {
  if (args.includes("--help") || args.includes("-h")) return;
  if (env.MULTIMIX_ALLOW_PAID_E2E === "true") return;
  throw new Error(
    `${suite} can call paid external providers. Set MULTIMIX_ALLOW_PAID_E2E=true to acknowledge and run it explicitly.`,
  );
}
