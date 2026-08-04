import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
  site: "https://agentallowance-docs.onrender.com",
  integrations: [
    starlight({
      title: "AgentAllowance",
      description: "Build policy-controlled x402 payments for AI agents on Stellar.",
      logo: {
        src: "../../docs/assets/agentallowance-logo.jpg",
        alt: "AgentAllowance",
      },
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/karagozemin/AgentAllowance" },
      ],
      customCss: ["./src/styles/custom.css"],
      head: [
        { tag: "meta", attrs: { name: "theme-color", content: "#0a0d0b" } },
        { tag: "link", attrs: { rel: "icon", type: "image/png", href: "https://agentallowance-console.onrender.com/favicon.png" } },
      ],
      pagination: true,
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", link: "/" },
            { label: "5-minute quickstart", slug: "getting-started/quickstart" },
            { label: "Core concepts", slug: "getting-started/core-concepts" },
          ],
        },
        {
          label: "Build with the SDK",
          items: [
            { label: "Install and configure", slug: "sdk/install" },
            { label: "Pay an x402 endpoint", slug: "sdk/pay-with-x402" },
            { label: "Manage allowances", slug: "sdk/allowances" },
            { label: "Handle errors", slug: "sdk/errors" },
            { label: "Reconcile settlement", slug: "sdk/reconciliation" },
          ],
        },
        {
          label: "Integration guides",
          items: [
            { label: "Freighter administration", slug: "guides/freighter" },
            { label: "Merchant and facilitator", slug: "guides/merchant-facilitator" },
            { label: "Testnet deployment", slug: "guides/testnet-deployment" },
            { label: "Production readiness", slug: "guides/production-readiness" },
          ],
        },
        {
          label: "Protocol",
          items: [
            { label: "Architecture", slug: "protocol/architecture" },
            { label: "Payment lifecycle", slug: "protocol/payment-lifecycle" },
            { label: "Authorization model", slug: "protocol/authorization" },
            { label: "Security model", slug: "protocol/security" },
          ],
        },
        {
          label: "Reference",
          items: [
            { label: "SDK API", slug: "reference/sdk-api" },
            { label: "Typed errors", slug: "reference/error-codes" },
            { label: "Packages", slug: "reference/packages" },
            { label: "Testnet addresses", slug: "reference/testnet" },
            { label: "Evidence and verification", slug: "reference/evidence" },
          ],
        },
      ],
    }),
  ],
});
